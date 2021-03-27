import { TextDocument } from 'vscode-html-languageservice';

export interface LangCache<T> {
  get(d: TextDocument): T;
  onDocumentRemoved(d: TextDocument): void;
  dispose(): void;
}

export function getLangCache<T>(max: number, secs: number, parse: (d: TextDocument) => T): LangCache<T> {
  let models: { [uri: string]: { version: number; id: string; time: number; model: T } } = {};
  let count = 0;
  let interval: NodeJS.Timer | undefined = undefined;
  if (secs > 0) {
    interval = setInterval(() => {
      const cutoff = Date.now() - secs * 1000;
      const ks = Object.keys(models);
      for (const k of ks) {
        const i = models[k];
        if (i.time < cutoff) {
          delete models[k];
          count--;
        }
      }
    }, secs * 1000);
  }
  return {
    get(d: TextDocument): T {
      const v = d.version;
      const id = d.languageId;
      const info = models[d.uri];
      if (info && info.version === v && info.id === id) {
        info.time = Date.now();
        return info.model;
      }
      const m = parse(d);
      models[d.uri] = { model: m, version: v, id: id, time: Date.now() };
      if (!info) count++;
      if (count === max) {
        let t = Number.MAX_VALUE;
        let old = undefined;
        for (const k in models) {
          const i = models[k];
          if (i.time < t) {
            old = k;
            t = i.time;
          }
        }
        if (old) {
          delete models[old];
          count--;
        }
      }
      return m;
    },
    onDocumentRemoved(d: TextDocument) {
      const k = d.uri;
      if (models[k]) {
        delete models[k];
        count--;
      }
    },
    dispose() {
      if (typeof interval !== 'undefined') {
        clearInterval(interval);
        interval = undefined;
        models = {};
        count = 0;
      }
    },
  };
}
