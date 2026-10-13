#!/usr/bin/env node
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import vm from "node:vm";
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
const vendorDirectory=path.resolve(here,"../../../observations/eighteenmile_2023/figures/vendor");
const vendorBodies=Object.fromEntries(await Promise.all(["d3-path","d3-shape"].map(async name=>[name,await fs.readFile(path.join(vendorDirectory,name+".cjs"),"utf8")])));
const vendorModules=new Map();
function requireVendor(name){
 if(vendorModules.has(name))return vendorModules.get(name);
 if(!Object.hasOwn(vendorBodies,name))throw Error("Unretained figure dependency: "+name);
 const module={exports:{}};vendorModules.set(name,module.exports);
 vm.runInNewContext(vendorBodies[name],{module,exports:module.exports,require:requireVendor},{filename:name+".cjs",timeout:5000});
 vendorModules.set(name,module.exports);return module.exports;
}
const d3={...requireVendor("d3-path"),...requireVendor("d3-shape")};
const svgFiles={};await fs.mkdir(path.join(here,"figures"),{recursive:true});
for(const figure of spec.figures){const name=figure.id+".svg";svgFiles[name]=renderScientificFigureSvg(figure,d3);await fs.writeFile(path.join(here,"figures",name),svgFiles[name]);}
await fs.writeFile(path.join(here,"publication-figures.html"),buildFigureGallery(spec,svgFiles));
console.log(JSON.stringify({figures:spec.figures.length,panels:spec.figures.reduce((n,f)=>n+f.panels.length,0),retained_plot_points:audit.length}));
