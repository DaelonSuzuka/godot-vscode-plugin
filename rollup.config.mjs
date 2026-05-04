import {nodeResolve} from '@rollup/plugin-node-resolve'

export default {
  input: './src/formatter/grammar/generated/test-indent.js',
  output: [{
    format: 'cjs',
    file: './src/formatter/grammar/dist/test-index.cjs'
  }, {
    format: 'es',
    file: './src/formatter/grammar/dist/test-index.js'
  }],
  external: [],
  plugins: [
    nodeResolve()
  ]
}