import * as ts from 'typescript';
import merge from 'deepmerge';

const deepMerge = <T>(a: any, b: any): T =>
  merge<T>(a, b, {
    arrayMerge: (dest: any[], src: any[]) => [...dest, ...src],
  });

/**
 * Reads any typescript configuration files for a given file, including the extends references
 * @param filePath the full file path to the file
 * @param defaultConfig optional default configuration
 * @param keepJson set to tru to avoid converting options
 * @returns the typescript configuration for the file, or undefined if this is not a typescript file
 */
export const getTypescriptConfig = (
  filePath: string,
  defaultConfig?: ts.CompilerOptions,
  keepJson?: boolean,
): ts.CompilerOptions | undefined => {
  if (typeof window !== 'undefined') {
    return defaultConfig;
  }
  const { resolve, dirname } = require('path');
  const readConfigFile = (configPath: string): any => {
    let config = ts.readConfigFile(configPath, ts.sys.readFile).config;
    if (config.extends) {
      const extendsPath = ts.findConfigFile(
        resolve(dirname(configPath), config.extends),
        ts.sys.fileExists,
      );
      if (extendsPath && extendsPath !== configPath) {
        config = deepMerge<any>(readConfigFile(extendsPath), config);
      }
    }
    return config;
  };
  const ext = filePath.split('.').pop()?.toLowerCase() || 'js';
  if (['ts', 'tsx'].indexOf(ext) !== -1) {
    let config: ts.CompilerOptions = defaultConfig || {};
    const configPath = ts.findConfigFile(dirname(filePath), ts.sys.fileExists);
    if (configPath) {
      const fileConfig = readConfigFile(configPath);
      if (fileConfig?.compilerOptions) {
        config = deepMerge<ts.CompilerOptions>(
          config,
          fileConfig?.compilerOptions,
        );
      }
      if (config.baseUrl) {
        config.baseUrl = resolve(dirname(configPath), config.baseUrl);
      }
    }

    if (keepJson) {
      return config;
    }

    const { options } = ts.convertCompilerOptionsFromJson(config, '.');

    return options;
  }
  return undefined;
};
