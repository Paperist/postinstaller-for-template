import * as glob from 'glob';

declare module 'glob' {
  export function async(
    pattern: string,
    options?: glob.IOptions
  ): Promise<string[]>;
}
