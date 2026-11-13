import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFile(path.join(root,file),'utf8');
await mkdir(path.join(root,'web/vendor'),{recursive:true});
await build({entryPoints:[path.join(root,'web/editor-entry.js')],bundle:true,format:'esm',minify:true,legalComments:'eof',outfile:path.join(root,'web/vendor/editor.js')});
const licensePaths=['@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/search','@codemirror/autocomplete','@codemirror/lang-python','@codemirror/merge','@lezer/common','@lezer/highlight','@lezer/lr','@lezer/python','crelt','style-mod','w3c-keyname'];
let notices='Bundled editor dependencies\n';
for(const name of licensePaths){try{notices+='\n--- '+name+' ---\n'+await readFile(path.join(root,'node_modules',name,'LICENSE'),'utf8')}catch{}}
await writeFile(path.join(root,'web/vendor/LICENSES.txt'),notices);
await import('./bundle-engine.mjs');
execFileSync(process.env.UPLIFTLAB_PYTHON || 'python3', [path.join(root, 'scripts/build-catalog.py')], {stdio: 'inherit'});  // a Python with EconML computes the example with the EconML built-ins
// Self-hosted fonts: Pretendard for Korean text, Archivo with its width axis for figures, Geist Mono for code. Archivo and
// Geist Mono keep only their Latin subsets. web/fonts/files is rebuilt from node_modules on every build.
const nm=p=>path.join(root,'node_modules',p);
const FONTS=[
  {name:'Pretendard',css:'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'},
  {name:'Archivo',css:'@fontsource-variable/archivo/wdth.css',keep:/archivo-latin(-ext)?-wdth-normal/,license:'@fontsource-variable/archivo/LICENSE'},
  {name:'Geist Mono',css:'@fontsource-variable/geist-mono/index.css',keep:/geist-mono-latin(-ext)?-wght-normal/,license:'@fontsource-variable/geist-mono/LICENSE'},
];
const fontFiles=path.join(root,'web/fonts/files');
await rm(fontFiles,{recursive:true,force:true});await mkdir(fontFiles,{recursive:true});
let fontCSS='',fontLicense='';
for(const f of FONTS){
  const css=await readFile(nm(f.css),'utf8'),dir=path.dirname(nm(f.css));
  for(const face of css.match(/@font-face\s*{[^}]*}/g)){
    const url=face.match(/url\(\.\/([^)]+)\)/)[1];
    if(f.keep&&!f.keep.test(url))continue;
    await cp(path.join(dir,url),path.join(fontFiles,path.basename(url)));
    fontCSS+=face.replace(/url\(\.\/[^)]+\)/,`url(./files/${path.basename(url)})`)+'\n';
  }
  fontLicense+=`--- ${f.name} ---\n${(f.license?await readFile(nm(f.license),'utf8'):css.match(/\/\*([\s\S]*?)\*\//)[1]).trim()}\n\n`;
}
await writeFile(path.join(root,'web/fonts/font.css'),fontCSS);
await writeFile(path.join(root,'web/fonts/LICENSE'),fontLicense);
const [html,css]=await Promise.all([read('web/index.html'),read('web/styles.css')]);
const js=await build({entryPoints:[path.join(root,'web/app.js')],bundle:true,format:'esm',write:false,minify:true,legalComments:'eof'});
const code=js.outputFiles[0].text;
let inlineFonts=fontCSS;
for(const match of fontCSS.matchAll(/url\(\.\/files\/([^)]*)\)/g)){const data=await readFile(path.join(fontFiles,match[1]));inlineFonts=inlineFonts.replace(match[0],`url(data:font/woff2;base64,${data.toString('base64')})`)}
const bundledCSS=css.replace("@import url('./fonts/font.css');",inlineFonts);
const output=html.replace(/<link rel="stylesheet" href="\.\/styles\.css(?:\?[^"]*)?">/,()=>`<style>${bundledCSS}</style>`).replace(/<script type="module" src="\.\/app\.js(?:\?[^"]*)?"><\/script>/,()=>`<script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/index.html'),output);
await cp(path.join(root,'web/data'),path.join(root,'dist/data'),{recursive:true});  // the Criteo sample and its license, fetched by the page
await cp(path.join(root,'docs/images/banner.png'),path.join(root,'dist/og.png'));  // the link preview image (og:image)
// The pip package ships web/ itself (see pyproject.toml), so the local edition needs no build step.
console.log('Built dist/index.html. The Python engine loads Pyodide from the CDN, or runs natively via upliftlab.');
