// Stub typings for `react-native-blob-util` so the TypeScript check passes
// before the user has run `npm install`. Once the package is installed, its
// own bundled `index.d.ts` (in `node_modules/react-native-blob-util/`) takes
// precedence over this ambient declaration — package-resolved imports beat
// module-level fallbacks.
//
// Surface here is intentionally narrow: only what `mobileAppDownload.ts`
// actually calls. Don't expand without need; the real types are richer and
// we want them to win once available.

declare module 'react-native-blob-util' {
  export type Encoding = 'utf8' | 'ascii' | 'base64';

  interface FetchBlobResponseInfo {
    status: number;
  }
  interface FetchBlobResponse {
    path(): string;
    info(): FetchBlobResponseInfo;
  }

  // The real StatefulPromise extends Promise; the stub keeps the methods we
  // need (`progress`, `cancel`) plus the awaitable shape.
  interface StatefulPromise<T> extends Promise<T> {
    cancel(cb?: (reason: any) => void): StatefulPromise<T>;
    progress(
      config: {count?: number; interval?: number},
      callback: (received: number | string, total: number | string) => void,
    ): StatefulPromise<T>;
  }

  interface ReactNativeBlobUtilReadStream {
    closed: boolean;
    open(): void;
    onData(fn: (chunk: string | number[]) => void): void;
    onError(fn: (err: any) => void): void;
    onEnd(fn: () => void): void;
  }

  interface ReactNativeBlobUtilConfig {
    fileCache?: boolean;
    overwrite?: boolean;
    path?: string;
    timeout?: number;
  }

  interface Dirs {
    DocumentDir: string;
    CacheDir: string;
    DownloadDir: string;
    [k: string]: string;
  }

  interface FS {
    dirs: Dirs;
    unlink(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    ls(path: string): Promise<string[]>;
    readStream(
      path: string,
      encoding: Encoding,
      bufferSize?: number,
      tick?: number,
    ): Promise<ReactNativeBlobUtilReadStream>;
  }

  interface ReactNativeBlobUtilStatic {
    fs: FS;
    config(options: ReactNativeBlobUtilConfig): {
      fetch(
        method: string,
        url: string,
        headers?: {[key: string]: string},
        body?: any,
      ): StatefulPromise<FetchBlobResponse>;
    };
    fetch(
      method: string,
      url: string,
      headers?: {[key: string]: string},
      body?: any,
    ): StatefulPromise<FetchBlobResponse>;
  }

  const ReactNativeBlobUtil: ReactNativeBlobUtilStatic;
  export default ReactNativeBlobUtil;
}
