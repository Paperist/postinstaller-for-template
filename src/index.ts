import * as libpath from 'path';
import * as fse from 'fs-extra';
import * as pkgDir from 'pkg-dir';
import * as inquirer from 'inquirer';
import * as ig from 'ignore';
import * as ora from 'ora';
import axios from 'axios';
import * as JSZip from 'jszip';
import * as iconv from 'iconv-lite';
import * as JsDiff from 'diff';
import * as glob from 'glob';
import * as pify from 'pify';

// Promisify
Object.assign(glob, {
  async: pify(glob),
});

interface FetchConfig {
  url: string;
  files: string[];
  encoding: string | null;
}

class PostInstaller {
  public packageName = process.env.npm_package_name;
  public logLevel = process.env.npm_config_loglevel;
  public templateDir = libpath.resolve(process.cwd(), `./.paperist/templates/`);
  public projectPath = pkgDir.sync(libpath.resolve(process.cwd(), '../'));
  public spinner = ora();
  public flags = {
    installExample: false,
    showInfo: false,
  };

  constructor() {
    if (!this.projectPath) {
      throw new Error('Root directory is not found.');
    }
    this.flags.showInfo = ['info', 'verbose', 'silly'].includes(this.logLevel!);
  }

  async run() {
    try {
      await this.setConfig();

      this.spinner.start('Fetching files...');
      await this.fetch();
      this.spinner.succeed('Fetched files.');

      this.spinner.start('Applying patches to files...');
      await this.patch();
      this.spinner.succeed('Applied patches to files.');

      this.spinner.start('Copying files to project folder...');
      await this.overwrite();
      this.spinner.succeed(`Installed "${this.packageName}".`);
    } catch (err) {
      this.spinner.fail(err.message);
      console.error(err.stack);
      throw err;
    }
  }

  async setConfig() {
    const { allowOverwrite } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'allowOverwrite',
        message:
          `Overwrite "${this.projectPath}" templates from ` +
          `"${this.packageName}". Are you sure?`,
      },
    ])) as { [key: string]: boolean };

    if (!allowOverwrite) {
      throw new Error('Avoid to install.');
    }

    const { installExample } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'installExample',
        message:
          'Could you install examples? (Current documents will be overwritten.)',
        default: false,
      },
    ])) as { [key: string]: boolean };
    this.flags.installExample = installExample;
  }

  async fetch() {
    const config = JSON.parse(
      await fse.readFile(
        libpath.resolve(process.cwd(), './package.json'),
        'utf8'
      )
    );

    if (!config.paperist || !config.paperist.fetch) {
      return false;
    }

    const { url, files, encoding } = config.paperist.fetch as FetchConfig;

    // Fetch data
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    if (this.flags.showInfo) {
      this.spinner.info(`Fetched from "${url}"`);
    }

    // Unzip
    const zip = await new JSZip().loadAsync(data);

    const fileObjList = zip.filter(path => files.includes(path));

    for (const file of fileObjList) {
      const buffer = await file.async('nodebuffer');
      const fileName = libpath.basename(file.name);
      const filePath = libpath.resolve(this.templateDir, `./${fileName}`);

      if (encoding) {
        const decoded = iconv.decode(buffer, encoding);
        await fse.writeFile(filePath, decoded, { encoding: 'utf8' });
      } else {
        await fse.writeFile(filePath, buffer);
      }
      if (this.flags.showInfo) {
        this.spinner.info(`Extracted "${file.name}"`);
      }
    }

    return true;
  }

  async patch() {
    const patchFiles = await glob.async(
      libpath.resolve(this.templateDir, './*.patch')
    );

    for (const patchFile of patchFiles) {
      const patchPath = libpath.resolve(
        this.templateDir,
        libpath.basename(patchFile)
      );
      const filePath = libpath.resolve(
        this.templateDir,
        libpath.basename(patchFile, '.patch')
      );

      if (!fse.existsSync(filePath)) {
        continue;
      }

      const original = await fse.readFile(filePath, 'utf8');
      const patchObj = JsDiff.parsePatch(await fse.readFile(patchPath, 'utf8'));

      const patched = JsDiff.applyPatch(original, patchObj, {
        compareLine(_lineNumber, line, _operation, patchContent) {
          return line.trim() === patchContent.trim();
        },
      });

      await fse.writeFile(filePath, patched, { encoding: 'utf8' });

      if (this.flags.showInfo) {
        this.spinner.info(`Applied patch to "${libpath.basename(filePath)}".`);
      }
    }
  }

  async overwrite() {
    const ignore = {
      template: ig().add(
        await fse.readFile(
          libpath.resolve(__dirname, '../.templateignore'),
          'utf8'
        )
      ),
      example: ig().add(
        await fse.readFile(
          libpath.resolve(__dirname, '../.exampleignore'),
          'utf8'
        )
      ),
    };

    const options = [
      { overwrite: true, ignore: ignore.template },
      { overwrite: this.flags.installExample, ignore: ignore.example },
    ];

    for (const { overwrite, ignore } of options) {
      await fse.copy(process.cwd(), this.projectPath!, {
        overwrite,
        filter: src => {
          if (libpath.isAbsolute(src)) {
            src = libpath.relative(process.cwd(), src);
          }
          const allow = !ignore.ignores(src);
          // Print copied path.
          if (allow && this.flags.showInfo) {
            this.spinner.info(`Copied "${src}"`);
          }
          // Allow root dir and not ignored.
          return allow || src === '';
        },
      });
    }
  }
}

new PostInstaller().run().catch(() => {
  process.exit(255);
});
