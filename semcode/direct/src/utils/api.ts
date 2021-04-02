import * as semver from 'semver';

export default class API {
  public static fromSimpleString(value: string): API {
    return new API(value, value, value);
  }

  public static readonly defaultVersion = API.fromSimpleString('1.0.0');
  public static readonly v420 = API.fromSimpleString('4.2.0');

  public static fromVersionString(versionString: string): API {
    let version = semver.valid(versionString);
    if (!version) {
      return new API('invalidVersion', '1.0.0', '1.0.0');
    }

    const index = versionString.indexOf('-');
    if (index >= 0) {
      version = version.substr(0, index);
    }
    return new API(versionString, version, versionString);
  }

  private constructor(public readonly displayName: string, public readonly version: string, public readonly fullVersionString: string) {}

  public eq(other: API): boolean {
    return semver.eq(this.version, other.version);
  }

  public gte(other: API): boolean {
    return semver.gte(this.version, other.version);
  }

  public lt(other: API): boolean {
    return !this.gte(other);
  }
}
