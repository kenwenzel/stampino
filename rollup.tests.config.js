import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import polyfills from 'rollup-plugin-node-polyfills';
import replace from 'rollup-plugin-replace'

export default {
    input: ['build/test/rdfa-sparql-engine_test-module.js'],
    output : {
        file : "build/test/rdfa-sparql-engine_test.js"
    },
    plugins : [
        replace({
            // sparql-engine tests for require.main somewhere that is not correctly replaced by rollup commonjs
            'require.main' : 'undefined'
        }),
        commonjs(),
        nodeResolve({ preferBuiltins: false }),
        polyfills()
    ]
};
