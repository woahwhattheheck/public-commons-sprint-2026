#!/usr/bin/env node
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createRequire} from "node:module";
import {renderScientificFigureSvg} from "./render-publication-svg.mjs";
import {buildFigureGallery} from "./figure-gallery.mjs";
import {buildPublicationFigures} from "./publication-figures.mjs";
import {csvOutput} from "./analysis.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const names=["annual-sampling-coverage.csv","calendar-support-comparisons.csv","flow-daily-2022.csv","flow-sample-join.csv"];
const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(here,name),"utf8")])));
const {spec,audit}=buildPublicationFigures(files);
await fs.writeFile(path.join(here,"publication-figures.json"),JSON.stringify(spec,null,2)+"\n");
await fs.writeFile(path.join(here,"publication-figure-source-points.csv"),csvOutput(audit));
const require=createRequire(import.meta.url),d3={...require("../../../observations/eighteenmile_2023/figures/vendor/d3-path.cjs"),...require("../../../observations/eighteenmile_2023/figures/vendor/d3-shape.cjs")};
const svgFiles={};await fs.mkdir(path.join(here,"figures"),{recursive:true});
for(const figure of spec.figures){const name=figure.id+".svg";svgFiles[name]=renderScientificFigureSvg(figure,d3);await fs.writeFile(path.join(here,"figures",name),svgFiles[name]);}
await fs.writeFile(path.join(here,"publication-figures.html"),buildFigureGallery(spec,svgFiles));
console.log(JSON.stringify({figures:spec.figures.length,panels:spec.figures.reduce((n,f)=>n+f.panels.length,0),retained_plot_points:audit.length}));
