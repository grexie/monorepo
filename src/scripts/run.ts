import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';
import chalk from 'chalk';
import { getWorkspaces } from '../utils/workspaces.js';
import { Lock, Mutex } from '@grexie/mutex';

interface RunOptions {
  parallel?: boolean;
  silent?: boolean;
  order?: string;
  exclude?: string;
}

interface ResolvablePromise<T = void>
  extends Required<Resolver<T>>,
    Promise<T> {}

interface Resolver<T = void> {
  readonly resolved: boolean;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

const createResolver = <T = void>() => {
  const resolver: Resolver<T> = {} as unknown as Resolver<T>;
  const promise = new Promise<T>((resolve, reject) => {
    let resolved = false;

    Object.assign(resolver, {
      get resolved() {
        return resolved;
      },
      resolve: (value: T) => {
        resolved = true;
        resolve(value);
      },
      reject: (err: Error) => {
        resolved = true;
        reject(err);
      },
    });
  });
  Object.assign(promise, resolver);
  return promise as unknown as ResolvablePromise<T>;
};

const stripAnsiCursor = (text: string) =>
  text.replace(
    /\033(c|\[\d+;\d+[Hf]|\[[HMsuJK]|\[\d+[ABCDEFGnJK]|\[[=?]\d+[hl])/g,
    ''
  );

export default async (
  { parallel = false, silent = false, order, exclude }: RunOptions,
  command: string,
  ...args: string[]
) => {
  let packages = getWorkspaces().filter(({ location }) =>
    /^packages\//.test(location)
  );

  const o = order?.split(/,/g) ?? [];
  packages.sort((a, b) => {
    const namea = a.workspace.split(/\//g).reverse()[0];
    const nameb = b.workspace.split(/\//g).reverse()[0];
    let indexa = o.indexOf(namea);
    let indexb = o.indexOf(nameb);

    if (indexa === -1) {
      indexa = o.length;
    }

    if (indexb === -1) {
      indexb = o.length;
    }

    return indexa - indexb;
  });

  const e = exclude?.split(/,/g) ?? [];
  packages = packages.filter(pkg => {
    const name = pkg.workspace.split(/\//g).reverse()[0];
    if (e.includes(name)) {
      return false;
    }

    return true;
  });

  const maxLength = packages.reduce(
    (a, b) => Math.max(a, basename(b.location).length),
    0
  );

  let runLock = new Mutex();
  let i = 0;
  const finished = createResolver();

  await Promise.all(
    packages.map(async ({ workspace, location }) => {
      const skipped = (reason: string) =>
        console.error(chalk.gray(`${workspace} skipped due to ${reason}`));

      const packagePath = resolve(location, 'package.json');

      if (!existsSync(packagePath)) {
        skipped('no package.json');
        return;
      }

      const pkg = JSON.parse(readFileSync(packagePath).toString());

      if (!pkg.scripts?.[command]) {
        skipped(`no script named ${command}`);
        return;
      }

      const logName = basename(location).padEnd(maxLength, ' ');

      let lock: Lock;
      if (!parallel) {
        lock = await runLock.lock();
      }

      if (!silent) {
        console.error(chalk.cyan(`[${logName}] yarn run ${command}`));
      }

      const child = spawn('yarn', ['run', command, ...args], {
        env: { ...process.env, FORCE_COLOR: '3' },
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: location,
      });

      child.stdout.on('data', data => {
        data = stripAnsiCursor(data.toString().trim());
        if (!data) {
          return;
        }
        const lines = data.split(/\n|\r\n|\r/g) as string[];
        lines.forEach(line => {
          process.stdout.write(chalk.cyan(`[${logName}] `));
          process.stdout.write(line);
          process.stdout.write('\n');
        });
      });
      child.stderr.on('data', data => {
        data = stripAnsiCursor(data.toString().trim());
        if (!data) {
          return;
        }
        const lines = data.split(/\n|\r\n/g) as string[];
        lines.forEach(line => {
          process.stderr.write(chalk.cyan(`[${logName}] `));
          process.stderr.write(line);
          process.stderr.write('\n');
        });
      });

      const childPromise = new Promise<{ workspace: string; code: number }>(
        (resolve, reject) => {
          child.on('exit', code => {
            if (code === 0) {
              resolve({ workspace, code });
            } else {
              reject({ workspace, code });
            }
            lock?.unlock();
          });
        }
      );

      finished.finally(() => child.kill('SIGTERM'));

      return childPromise;
    })
  ).finally(() => !finished.resolved && finished.resolve());
};

export const args = {
  boolean: ['parallel', 'silent'],
  alias: {
    parallel: 'p',
    silent: 's',
    order: 'o',
    exclude: 'e',
  },
  stopEarly: true,
};
