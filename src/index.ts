import * as libpath from 'path';
import * as fse from 'fs-extra';
import * as pkgDir from 'pkg-dir';
import * as inquirer from 'inquirer';
import * as ignore from 'ignore';
import * as ora from 'ora';

const packageName = process.env.npm_package_name;
const logLevel = process.env.npm_config_loglevel;
const spinner = ora();

(async () => {
  const templateIgnore = ignore().add(
    await fse.readFile(libpath.resolve(__dirname, '../.templateignore'), 'utf8')
  );
  const exampleIgnore = ignore().add(
    await fse.readFile(libpath.resolve(__dirname, '../.exampleignore'), 'utf8')
  );

  const projectPath = await pkgDir(libpath.resolve(process.cwd(), '../'));
  if (!projectPath) {
    throw new Error('Root directory is not found.');
  }

  const { allowOverwrite } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'allowOverwrite',
      message: `Overwrite "${projectPath}" templates from "${packageName}". Are you sure?`,
    },
  ]);
  if (!allowOverwrite) {
    throw new Error('Avoid to install.');
  }

  const { installExample } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'installExample',
      message:
        'Could you install examples? (Current documents will be overwritten.)',
      default: false,
    },
  ]);
  const ig = installExample ? exampleIgnore : templateIgnore;

  spinner.start('Copying files to project folder...');

  await fse.copy(process.cwd(), projectPath, {
    overwrite: true,
    filter(src) {
      if (libpath.isAbsolute(src)) {
        src = libpath.relative(process.cwd(), src);
      }
      const allow = ig.ignores(src);
      // Print copied path.
      if (allow && logLevel !== 'silent') {
        spinner.info(`Copied ${src}`);
      }
      // Allow root dir and not ignored.
      return allow || src === '';
    },
  });

  spinner.succeed(`Done to install "${packageName}".`);
})().catch((err: Error) => {
  spinner.fail(err.message);
  process.exit(255);
});
