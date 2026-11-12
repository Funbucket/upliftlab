import {EditorState} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput} from '@codemirror/language';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
import {python} from '@codemirror/lang-python';
import {tags} from '@lezer/highlight';
import {MergeView} from '@codemirror/merge';
const theme = EditorView.theme({
  '&':{height:'100%',fontSize:'13px',backgroundColor:'#0b0d11',color:'#d5dae1'},
  '.cm-scroller':{fontFamily:'"Geist Mono Variable", "SFMono-Regular", Menlo, Consolas, "Pretendard Variable", monospace',lineHeight:'1.75',overflow:'auto'},
  '.cm-content':{padding:'18px 0',caretColor:'#9cc0ff'},'.cm-line':{padding:'0 20px 0 10px'},'.cm-cursor':{borderLeftColor:'#9cc0ff'},
  '.cm-gutters':{backgroundColor:'#0b0d11',color:'#4a525d',border:'none',minWidth:'44px'},
  '.cm-activeLineGutter':{backgroundColor:'#11141a',color:'#9aa3af'},'.cm-activeLine':{backgroundColor:'#0f1217'},
  '&.cm-focused':{outline:'none'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#1d3354!important'},
  '.cm-matchingBracket':{backgroundColor:'#22324a',color:'#f3f5f8'},
  '.cm-searchMatch':{backgroundColor:'#4a3b12'},'.cm-panels':{backgroundColor:'#11141a',color:'#d5dae1'},
  '.cm-tooltip':{backgroundColor:'#171b22',border:'1px solid #262b34',color:'#d5dae1'},
  '.cm-changedLine':{backgroundColor:'rgba(77,141,255,.08)!important'},'.cm-changedText':{background:'rgba(77,141,255,.35)!important'},
  '.cm-deletedChunk':{backgroundColor:'rgba(255,107,107,.1)!important'}
}, {dark: true});
const highlight=HighlightStyle.define([{tag:tags.keyword,color:'#c39bff'},{tag:tags.string,color:'#7fd6b0'},{tag:tags.comment,color:'#6b7480',fontStyle:'italic'},{tag:tags.number,color:'#f3b27a'},{tag:tags.function(tags.variableName),color:'#8fb8ff'},{tag:tags.definition(tags.variableName),color:'#f3f5f8'},{tag:tags.operator,color:'#9aa3af'},{tag:tags.bool,color:'#f3b27a'},{tag:tags.className,color:'#ffd38a'}]);
const extensions = [lineNumbers(),highlightActiveLineGutter(),history(),drawSelection(),rectangularSelection(),indentOnInput(),bracketMatching(),closeBrackets(),highlightActiveLine(),highlightSelectionMatches(),python(),syntaxHighlighting(highlight),theme,keymap.of([...closeBracketsKeymap,...defaultKeymap,...searchKeymap,...historyKeymap,indentWithTab])];
export function createEditor(parent, code, onChange, onRun, readonly=false) {
  const view=new EditorView({parent,state:EditorState.create({doc:code,extensions:[...extensions,EditorState.readOnly.of(readonly),EditorView.editable.of(!readonly),keymap.of([{key:'Mod-Enter',run:()=>{onRun?.();return true}}]),EditorView.updateListener.of(u=>{if(u.docChanged)onChange?.(u.state.doc.toString())})]})});
  return {view,getValue:()=>view.state.doc.toString(),setValue(value){if(view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}})},focus:()=>view.focus(),goTo(line){const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});view.focus()},destroy:()=>view.destroy()};
}
export function createDiff(parent, before, after) {
  const merge=new MergeView({parent,a:{doc:before,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},b:{doc:after,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},highlightChanges:true,gutter:true});
  return {destroy:()=>merge.destroy()};
}
