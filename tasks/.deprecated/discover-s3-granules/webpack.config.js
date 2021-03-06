module.exports = {
  entry: ['babel-polyfill', './index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  devtool: 'sourcemap',
  module: {
    loaders: [{
      test: /\.js?$/,
      exclude: /node_modules(?!\/@cumulus)/,
      loader: 'babel'
    }, {
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
