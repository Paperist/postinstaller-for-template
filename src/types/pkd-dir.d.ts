declare module 'pkg-dir' {
  interface pkgDir {
    (cwd?: string): Promise<string | null>;
    sync(cwd?: string): string | null;
  }
  var pkgDir: pkgDir;
  export = pkgDir;
}
