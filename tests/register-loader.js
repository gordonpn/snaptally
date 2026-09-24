import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/sql-loader.mjs", pathToFileURL("./"));
