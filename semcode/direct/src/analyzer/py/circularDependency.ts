export class CircularDependency {
  private _paths: string[] = [];

  appendPath(path: string) {
    this._paths.push(path);
  }

  getPaths() {
    return this._paths;
  }

  normalizeOrder() {
    let firstIndex = 0;
    this._paths.forEach((path, index) => {
      if (path < this._paths[firstIndex]) {
        firstIndex = index;
      }
    });

    if (firstIndex !== 0) {
      this._paths = this._paths.slice(firstIndex).concat(this._paths.slice(0, firstIndex));
    }
  }

  isEqual(circDependency: CircularDependency) {
    if (circDependency._paths.length !== this._paths.length) {
      return false;
    }

    for (let i = 0; i < this._paths.length; i++) {
      if (this._paths[i] !== circDependency._paths[i]) {
        return false;
      }
    }

    return true;
  }
}
