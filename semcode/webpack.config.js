//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

'use strict';

const path = require('path');
const merge = require('merge-options');

module.exports = function withDefaults(/**@type WebpackConfig*/ extConfig) {
  /** @type WebpackConfig */
  let defaultConfig = {
    target: 'node',
    mode: 'none',
    node: {
      __dirname: false,
    },
    entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
    output: {
      filename: '[name].js',
      path: path.join(extConfig.context, 'out'),
      libraryTarget: 'commonjs',
      //path: path.resolve(__dirname, 'dist'),
      //filename: 'extension.js',
      //libraryTarget: 'commonjs2',
    },
    devtool: 'nosources-source-map',
    externals: {
      vscode: 'commonjs vscode',
    },
    resolve: {
      mainFields: ['module', 'main'],
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                compilerOptions: {
                  sourceMap: true,
                },
              },
            },
          ],
        },
      ],
    },
  };
  return merge(defaultConfig, extConfig);
};
