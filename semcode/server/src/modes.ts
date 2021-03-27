import { LanguageService as CSSService, getLanguageService as getCSSService } from 'vscode-css-languageservice';
import { CompletionList, Diagnostic, HTMLLanguageService as HTMLService, getLanguageService as getHTMLService, Position, Range, TextDocument } from 'vscode-html-languageservice';
import { getDocumentRegions, HTMLDocRegions } from '../../lsp-embedded-language-service/server/src/embed';
import { getLangCache, LangCache } from './cache';

// export * from 'vscode-html-languageservice';

export interface LangMode {
  getId(): string;
  doValidation?: (d: TextDocument) => Diagnostic[];
  doComplete?: (d: TextDocument, p: Position) => CompletionList;
  onDocumentRemoved(d: TextDocument): void;
  dispose(): void;
}

export function getCSSMode(s: CSSService, rs: LangCache<HTMLDocRegions>): LangMode {
  return {
    getId() {
      return 'css';
    },
    doValidation(d: TextDocument) {
      const e = rs.get(d).getEmbeddedDocument('css');
      const ss = s.parseStylesheet(e);
      return s.doValidation(e, ss);
    },
    doComplete(d: TextDocument, p: Position) {
      const e = rs.get(d).getEmbeddedDocument('css');
      const ss = s.parseStylesheet(e);
      return s.doComplete(e, p, ss);
    },
    onDocumentRemoved(_: TextDocument) {},
    dispose() {},
  };
}

export function getHTMLMode(s: HTMLService): LangMode {
  return {
    getId() {
      return 'html';
    },
    doComplete(d: TextDocument, p: Position) {
      return s.doComplete(d, p, s.parseHTMLDocument(d));
    },
    onDocumentRemoved(_: TextDocument) {},
    dispose() {},
  };
}

export interface LangModes {
  getModeAtPosition(d: TextDocument, p: Position): LangMode | undefined;
  getModesInRange(d: TextDocument, r: Range): LangModeRange[];
  getAllModes(): LangMode[];
  getAllModesInDocument(d: TextDocument): LangMode[];
  getMode(id: string): LangMode | undefined;
  onDocumentRemoved(d: TextDocument): void;
  dispose(): void;
}

export interface LangModeRange extends Range {
  mode?: LangMode;
  attrVal?: boolean;
}

export function getLangModes(): LangModes {
  const html = getHTMLService();
  const css = getCSSService();
  const regions = getLangCache<HTMLDocRegions>(10, 60, (d) => getDocumentRegions(html, d));
  let caches: LangCache<any>[] = [];
  caches.push(regions);
  let modes = Object.create(null);
  modes['html'] = getHTMLMode(html);
  modes['css'] = getCSSMode(css, regions);
  return {
    getModeAtPosition(d: TextDocument, p: Position): LangMode | undefined {
      const id = regions.get(d).getLanguageAtPosition(p);
      return id ? modes[id] : undefined;
    },
    getModesInRange(d: TextDocument, r: Range): LangModeRange[] {
      return regions
        .get(d)
        .getLanguageRanges(r)
        .map((x) => {
          return <LangModeRange>{ start: x.start, end: x.end, mode: x.languageId && modes[x.languageId], attrVal: x.attrVal };
        });
    },
    getAllModesInDocument(d: TextDocument): LangMode[] {
      const y = [];
      for (const i of regions.get(d).getLanguagesInDocument()) {
        const m = modes[i];
        if (m) y.push(m);
      }
      return y;
    },
    getAllModes(): LangMode[] {
      const y = [];
      for (const i in modes) {
        const m = modes[i];
        if (m) y.push(m);
      }
      return y;
    },
    getMode(id: string): LangMode {
      return modes[id];
    },
    onDocumentRemoved(d: TextDocument) {
      caches.forEach((c) => c.onDocumentRemoved(d));
      for (const m in modes) {
        modes[m].onDocumentRemoved(d);
      }
    },
    dispose(): void {
      caches.forEach((c) => c.dispose());
      caches = [];
      for (const m in modes) {
        modes[m].dispose();
      }
      modes = {};
    },
  };
}
