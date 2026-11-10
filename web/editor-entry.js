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
  '&':{height:'100%',fontSize:'13px',backgroundColor:'#fff'},
  '.cm-scroller':{fontFamily:'"SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Noto Sans KR Variable", monospace',lineHeight:'1.75',overflow:'auto'},
  '.cm-content':{padding:'18px 0'},'.cm-line':{padding:'0 20px 0 10px'},
  '.cm-gutters':{backgroundColor:'#fff',color:'#a1a9b7',border:'none',minWidth:'44px'},
  '.cm-activeLineGutter':{backgroundColor:'#f4f7fb',color:'#53627b'},'.cm-activeLine':{backgroundColor:'#f7f9fc'},
  '&.cm-focused':{outline:'none'},'.cm-selectionBackground':{backgroundColor:'#dceaff!important'},
  '.cm-searchMatch':{backgroundColor:'#ffeca5'},'.cm-panels':{backgroundColor:'#f5f7fa',color:'#354052'}
});
const highlight=HighlightStyle.define([{tag:tags.keyword,color:'#7754a5'},{tag:tags.string,color:'#39816d'},{tag:tags.comment,color:'#7f8ea2'},{tag:tags.number,color:'#b07a47'},{tag:tags.function(tags.variableName),color:'#356caa'},{tag:tags.definition(tags.variableName),color:'#334b69'},{tag:tags.operator,color:'#7b8696'}]);
const extensions = [lineNumbers(),highlightActiveLineGutter(),history(),drawSelection(),rectangularSelection(),indentOnInput(),bracketMatching(),closeBrackets(),highlightActiveLine(),highlightSelectionMatches(),python(),syntaxHighlighting(highlight),theme,keymap.of([...closeBracketsKeymap,...defaultKeymap,...searchKeymap,...historyKeymap,indentWithTab])];
export function createEditor(parent, code, onChange, onRun, readonly=false) {
  const view=new EditorView({parent,state:EditorState.create({doc:code,extensions:[...extensions,EditorState.readOnly.of(readonly),EditorView.editable.of(!readonly),keymap.of([{key:'Mod-Enter',run:()=>{onRun?.();return true}}]),EditorView.updateListener.of(u=>{if(u.docChanged)onChange?.(u.state.doc.toString())})]})});
  return {view,getValue:()=>view.state.doc.toString(),setValue(value){if(view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}})},focus:()=>view.focus(),goTo(line){const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});view.focus()},destroy:()=>view.destroy()};
}
export function createDiff(parent, before, after) {
  const merge=new MergeView({parent,a:{doc:before,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},b:{doc:after,extensions:[...extensions,EditorState.readOnly.of(true),EditorView.editable.of(false)]},highlightChanges:true,gutter:true});
  return {destroy:()=>merge.destroy()};
}
