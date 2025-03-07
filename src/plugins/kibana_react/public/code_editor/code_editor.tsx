/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import React from 'react';
import ReactResizeDetector from 'react-resize-detector';
import MonacoEditor from 'react-monaco-editor';
import { monaco } from '@kbn/monaco';

import {
  DARK_THEME,
  LIGHT_THEME,
  DARK_THEME_TRANSPARENT,
  LIGHT_THEME_TRANSPARENT,
} from './editor_theme';

import './editor.scss';

export interface Props {
  /** Width of editor. Defaults to 100%. */
  width?: string | number;

  /** Height of editor. Defaults to 100%. */
  height?: string | number;

  /** ID of the editor language */
  languageId: string;

  /** Value of the editor */
  value: string;

  /** Function invoked when text in editor is changed */
  onChange?: (value: string, event: monaco.editor.IModelContentChangedEvent) => void;

  /**
   * Options for the Monaco Code Editor
   * Documentation of options can be found here:
   * https://microsoft.github.io/monaco-editor/api/interfaces/monaco.editor.istandaloneeditorconstructionoptions.html
   */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;

  /**
   * Suggestion provider for autocompletion
   * Documentation for the provider can be found here:
   * https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.completionitemprovider.html
   */
  suggestionProvider?: monaco.languages.CompletionItemProvider;

  /**
   * Signature provider for function parameter info
   * Documentation for the provider can be found here:
   * https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.signaturehelpprovider.html
   */
  signatureProvider?: monaco.languages.SignatureHelpProvider;

  /**
   * Hover provider for hover documentation
   * Documentation for the provider can be found here:
   * https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.hoverprovider.html
   */
  hoverProvider?: monaco.languages.HoverProvider;

  /**
   * Language config provider for bracket
   * Documentation for the provider can be found here:
   * https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.languageconfiguration.html
   */
  languageConfiguration?: monaco.languages.LanguageConfiguration;

  /**
   * Function called before the editor is mounted in the view
   */
  editorWillMount?: () => void;
  /**
   * Function called before the editor is mounted in the view
   * and completely replaces the setup behavior called by the component
   */
  overrideEditorWillMount?: () => void;

  /**
   * Function called after the editor is mounted in the view
   */
  editorDidMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;

  /**
   * Should the editor use the dark theme
   */
  useDarkTheme?: boolean;

  /**
   * Should the editor use a transparent background
   */
  transparentBackground?: boolean;

  /**
   * Should the editor be rendered using the fullWidth EUI attribute
   */
  fullWidth?: boolean;
}

export class CodeEditor extends React.Component<Props, {}> {
  _editor: monaco.editor.IStandaloneCodeEditor | null = null;

  _editorWillMount = (__monaco: unknown) => {
    if (__monaco !== monaco) {
      throw new Error('react-monaco-editor is using a different version of monaco');
    }

    if (this.props.overrideEditorWillMount) {
      this.props.overrideEditorWillMount();
      return;
    }

    if (this.props.editorWillMount) {
      this.props.editorWillMount();
    }

    monaco.languages.onLanguage(this.props.languageId, () => {
      if (this.props.suggestionProvider) {
        monaco.languages.registerCompletionItemProvider(
          this.props.languageId,
          this.props.suggestionProvider
        );
      }

      if (this.props.signatureProvider) {
        monaco.languages.registerSignatureHelpProvider(
          this.props.languageId,
          this.props.signatureProvider
        );
      }

      if (this.props.hoverProvider) {
        monaco.languages.registerHoverProvider(this.props.languageId, this.props.hoverProvider);
      }

      if (this.props.languageConfiguration) {
        monaco.languages.setLanguageConfiguration(
          this.props.languageId,
          this.props.languageConfiguration
        );
      }
    });

    // Register themes
    monaco.editor.defineTheme('euiColors', this.props.useDarkTheme ? DARK_THEME : LIGHT_THEME);
    monaco.editor.defineTheme(
      'euiColorsTransparent',
      this.props.useDarkTheme ? DARK_THEME_TRANSPARENT : LIGHT_THEME_TRANSPARENT
    );
  };

  _editorDidMount = (editor: monaco.editor.IStandaloneCodeEditor, __monaco: unknown) => {
    if (__monaco !== monaco) {
      throw new Error('react-monaco-editor is using a different version of monaco');
    }

    this._editor = editor;

    if (this.props.editorDidMount) {
      this.props.editorDidMount(editor);
    }
  };

  render() {
    const { languageId, value, onChange, width, height, options } = this.props;

    return (
      <>
        <MonacoEditor
          theme={this.props.transparentBackground ? 'euiColorsTransparent' : 'euiColors'}
          language={languageId}
          value={value}
          onChange={onChange}
          width={width}
          height={height}
          editorWillMount={this._editorWillMount}
          editorDidMount={this._editorDidMount}
          options={{
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            minimap: {
              enabled: false,
            },
            scrollbar: {
              useShadows: false,
            },
            wordBasedSuggestions: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            matchBrackets: 'never',
            fontFamily: 'Roboto Mono',
            fontSize: 12,
            lineHeight: 21,
            ...options,
          }}
        />
        <ReactResizeDetector
          handleWidth
          handleHeight
          onResize={this._updateDimensions}
          refreshMode="debounce"
        />
      </>
    );
  }

  _updateDimensions = () => {
    if (this._editor) {
      this._editor.layout();
    }
  };
}

// React.lazy requires default export
// eslint-disable-next-line import/no-default-export
export default CodeEditor;
