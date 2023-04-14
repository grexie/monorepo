import { getWorkspaces, getWorkspacesRoot } from "../../utils/workspaces.js";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

export default () => {
  const workspaces = getWorkspaces();
  const workspacesRoot = getWorkspacesRoot();

  const tsconfig = JSON.parse(
    readFileSync(path.resolve(workspacesRoot, "tsconfig.json")).toString()
  );
  tsconfig.references = workspaces.map(({ location: path }) => ({ path }));
  writeFileSync(
    path.resolve(workspacesRoot, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2)
  );
};

export const args = {};
