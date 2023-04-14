import glob from "glob";
import { dirname, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const findWorkspaceRoot = () => {
  let dirname = path.resolve(__dirname, "..", "..");
  while (path.dirname(dirname) !== dirname) {
    if (existsSync(path.resolve(dirname, "package.json"))) {
      if (
        JSON.parse(
          readFileSync(path.resolve(__dirname, "package.json")).toString()
        ).workspaces
      ) {
        return dirname;
      } else {
        dirname = path.dirname(dirname);
      }
    }
    if (path.basename(dirname) === "node_modules") {
      dirname = path.dirname(dirname);
    } else {
      throw new Error("unable to find workspace root");
    }
  }
};

export const getWorkspaces = () => {
  const workspaceGlobs: string[] = JSON.parse(
    readFileSync(resolve(findWorkspaceRoot(), "package.json")).toString()
  ).workspaces;

  const packageFiles = workspaceGlobs
    .map((g) => glob.sync(g + "/package.json"))
    .reduce((a: string[], b: string[]) => [...a, ...b], []);

  return packageFiles
    .map((filename) => {
      try {
        const json = JSON.parse(readFileSync(filename).toString());
        return {
          workspace: json.name as string,
          location: dirname(filename),
        };
      } catch (err) {
        console.error(chalk.bold.red(filename));
      }
    })
    .filter(({ location }) => !location.startsWith("tools/"));
};
