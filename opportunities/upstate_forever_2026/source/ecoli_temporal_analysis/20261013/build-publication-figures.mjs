#!/usr/bin/env node
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {buildPublicationFigures} from "./publication-figures.mjs";
import {csvOutput} from "./analysis.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const names=["annual-sampling-coverage.csv","calendar-support-comparisons.csv","flow-daily-2022.csv","flow-sample-join.csv"];
const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(here,name),"utf8")])));
const {spec,audit}=buildPublicationFigures(files);
await fs.writeFile(path.join(here,"publication-figures.json"),JSON.stringify(spec,null,2)+"\n");
await fs.writeFile(path.join(here,"publication-figure-source-points.csv"),csvOutput(audit));
console.log(JSON.stringify({figures:spec.figures.length,panels:spec.figures.reduce((n,f)=>n+f.panels.length,0),retained_plot_points:audit.length}));
