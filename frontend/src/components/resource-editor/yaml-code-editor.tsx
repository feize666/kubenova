'use client';

import { useEffect, useRef } from 'react';
import { Annotation, Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { load } from 'js-yaml';
import styles from './yaml-code-editor.module.css';

export interface YamlCodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  embedded?: boolean;
  ariaLabel?: string;
}

const externalValue = Annotation.define<boolean>();
const vimPalette = HighlightStyle.define([
  { tag: tags.propertyName, color: '#f0a45b' },
  { tag: tags.string, color: '#a9e875' },
  { tag: tags.number, color: '#b8efb0' },
  { tag: [tags.bool, tags.null], color: '#cb9cff' },
  { tag: tags.comment, color: '#888' },
  { tag: tags.punctuation, color: '#d4d4d4' },
]);

// Lezer treats unquoted scalars uniformly; use YAML's parser for their value types.
const scalarColors = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.highlight(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.highlight(update.view);
  }
  highlight(view: EditorView) {
    const ranges = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({ from, to, enter: node => {
        if (node.name !== 'Literal' || node.node.parent?.name === 'Key') return;
        let scalar: unknown;
        try { scalar = load(view.state.sliceDoc(node.from, node.to)); } catch { scalar = ''; }
        const className = typeof scalar === 'number' ? styles.number : typeof scalar === 'boolean' || scalar === null ? styles.boolean : styles.string;
        ranges.add(node.from, node.to, Decoration.mark({ class: className }));
      } });
    }
    return ranges.finish();
  }
}, { decorations: plugin => plugin.decorations });

export function YamlCodeEditor({ value, onChange, readOnly = false, embedded = false, ariaLabel = '资源 YAML' }: YamlCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const initial = useRef({ value, readOnly, ariaLabel });
  const viewRef = useRef<EditorView | null>(null);
  const editability = useRef(new Compartment());
  const lineSeparator = useRef(new Compartment());

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(),
          drawSelection(), highlightSelectionMatches(), indentOnInput(), history(), yaml(),
          syntaxHighlighting(vimPalette), scalarColors,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorState.tabSize.of(2),
          lineSeparator.current.of(EditorState.lineSeparator.of(initial.current.value.includes('\r\n') ? '\r\n' : '\n')),
          editability.current.of([EditorState.readOnly.of(initial.current.readOnly), EditorView.editable.of(!initial.current.readOnly)]),
          EditorView.contentAttributes.of({ 'aria-label': initial.current.ariaLabel, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalValue))) {
              onChangeRef.current?.(update.state.sliceDoc());
            }
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editability.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ 'aria-readonly': String(readOnly), 'aria-label': ariaLabel })]) });
  }, [readOnly, ariaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.sliceDoc() === value) return;
    // Form/import/restore changes update the view without invalidating the parent's preview again.
    const separator = value.includes('\r\n') ? '\r\n' : '\n';
    const document = EditorState.create({ doc: value, extensions: EditorState.lineSeparator.of(separator) }).doc;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: document }, effects: lineSeparator.current.reconfigure(EditorState.lineSeparator.of(separator)), annotations: externalValue.of(true) });
  }, [value]);

  return <div ref={host} className={styles.editor} data-yaml-code-editor="true" data-embedded={embedded || undefined} />;
}
