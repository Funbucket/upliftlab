import {EditorState} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput} from '@codemirror/language';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
import {python} from '@codemirror/lang-python';
import {tags} from '@lezer/highlight';
import {MergeView} from '@codemirror/merge';
// Colors are the page tokens from styles.css, so the editor follows the light or dark theme without a rebuild.
const theme = EditorView.theme({
  '&':{height:'100%',fontSize:'13px',backgroundColor:'var(--card)',color:'var(--ink-2)'},
  '.cm-scroller':{fontFamily:'"Geist Mono Variable", "SFMono-Regular", Menlo, Consolas, "Pretendard Variable", monospace',lineHeight:'1.75',overflow:'auto'},
  '.cm-content':{padding:'18px 0',caretColor:'var(--blue-strong)'},'.cm-line':{padding:'0 20px 0 10px'},'.cm-cursor':{borderLeftColor:'var(--blue-strong)'},
  '.cm-gutters':{backgroundColor:'var(--card)',color:'var(--faint)',border:'none',minWidth:'44px'},
  '.cm-activeLineGutter':{backgroundColor:'var(--raise)',color:'var(--sub)'},'.cm-activeLine':{backgroundColor:'var(--ed-active)'},
  '&.cm-focused':{outline:'none'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--ed-sel)!important'},
  '.cm-matchingBracket':{backgroundColor:'var(--ed-bracket)',color:'var(--ink)'},
  '.cm-searchMatch':{backgroundColor:'var(--ed-search)'},'.cm-panels':{backgroundColor:'var(--raise)',color:'var(--ink-2)'},
  '.cm-tooltip':{backgroundColor:'var(--pop)',border:'1px solid var(--line)',color:'var(--ink-2)'},
  '.cm-changedLine':{backgroundColor:'var(--blue-wash)!important'},'.cm-changedText':{background:'color-mix(in srgb, var(--blue) 30%, transparent)!important'},
  '.cm-deletedChunk':{backgroundColor:'var(--red-soft)!important'}
});
const highlight=HighlightStyle.define([{tag:tags.keyword,color:'var(--syn-kw)'},{tag:tags.string,color:'var(--syn-str)'},{tag:tags.comment,color:'var(--mute)',fontStyle:'italic'},{tag:tags.number,color:'var(--syn-num)'},{tag:tags.function(tags.variableName),color:'var(--syn-fn)'},{tag:tags.definition(tags.variableName),color:'var(--ink)'},{tag:tags.operator,color:'var(--sub)'},{tag:tags.bool,color:'var(--syn-num)'},{tag:tags.className,color:'var(--syn-class)'}]);
const extensions = [lineNumbers(),highlightActiveLineGutter(),history(),drawSelection(),rectangularSelection(),indentOnInput(),bracketMatching(),closeBrackets(),highlightActiveLine(),highlightSelectionMatches(),python(),syntaxHighlighting(highlight),theme,keymap.of([...closeBracketsKeymap,...defaultKeymap,...searchKeymap,...historyKeymap,indentWithTab])];
export function createEditor(parent, code, onChange, onRun, readonly=false) {
  const view=new EditorView({parent,state:EditorState.create({doc:code,extensions:[...extensions,EditorState.readOnly.of(readonly),EditorView.editable.of(!readonly),keymap.of([{key:'Mod-Enter',run:()=>{onRun?.();return true}}]),EditorView.updateListener.of(u=>{if(u.docChanged)onChange?.(u.state.doc.toString())})]})});
  return {view,getValue:()=>view.state.doc.toString(),setValue(value){if(view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}})},focus:()=>view.focus(),goTo(line){const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});view.focus()},destroy:()=>view.destroy()};
}
export function createDiff(parent, before, after) {
  const merge=new MergeView({parent,a:{doc:before,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},b:{doc:after,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},highlightChanges:true,gutter:true});
  return {destroy:()=>merge.destroy()};
}
