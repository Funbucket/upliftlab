import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
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
execFileSync('python3', [path.join(root, 'scripts/build-catalog.py')], {stdio: 'inherit'});
const fontRoot=path.join(root,'node_modules/@fontsource-variable/noto-sans-kr');
await mkdir(path.join(root,'web/fonts'),{recursive:true});
await cp(path.join(fontRoot,'files'),path.join(root,'web/fonts/files'),{recursive:true});
const fontCSS=await readFile(path.join(fontRoot,'index.css'),'utf8');
await writeFile(path.join(root,'web/fonts/font.css'),fontCSS);
await cp(path.join(fontRoot,'LICENSE'),path.join(root,'web/fonts/LICENSE'));
const [html,css]=await Promise.all([read('web/index.html'),read('web/styles.css')]);
const js=await build({entryPoints:[path.join(root,'web/app.js')],bundle:true,format:'esm',write:false,minify:true,legalComments:'eof'});
const code=js.outputFiles[0].text;
let inlineFonts=fontCSS;
for(const match of fontCSS.matchAll(/url\(\.\/files\/([^)]*)\)/g)){const data=await readFile(path.join(fontRoot,'files',match[1]));inlineFonts=inlineFonts.replace(match[0],`url(data:font/woff2;base64,${data.toString('base64')})`)}
const bundledCSS=css.replace("@import url('./fonts/font.css');",inlineFonts);
const output=html.replace(/<link rel="stylesheet" href="\.\/styles\.css(?:\?[^"]*)?">/,()=>`<style>${bundledCSS}</style>`).replace(/<script type="module" src="\.\/app\.js(?:\?[^"]*)?"><\/script>/,()=>`<script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/index.html'),output);
// The pip package ships web/ itself (see pyproject.toml), so the local edition needs no build step.
console.log('Built dist/index.html. The Python engine loads Pyodide from the CDN, or runs natively via upliftlab.');
