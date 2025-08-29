import fs           from 'fs'
import * as esbuild from 'esbuild'
import path         from 'path'

type Loader = 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'json' | 'text' | 'base64' | 'dataurl' | 'file' | 'binary'

interface BuildOptions {
  bundle       : boolean
  minify       : boolean
  sourcemap    : boolean
  target       : string[]
  entryPoints? : string[]
  outfile?     : string
  format?      : 'esm' | 'iife'
  loader?      : { [ext: string]: Loader }
  alias?       : { [pkg: string]: string }
  resolveExtensions?: string[]
  publicPath?: string
  assetNames?: string
  plugins?: any[]
  external?: string[]
}

const PUBLIC_DIR = 'public'
const DIST_DIR   = 'dist'

async function build(): Promise<void> {
  const watch = process.argv.includes('--watch')

  // Clean dist directory.
  fs.rmSync(`./${DIST_DIR}`, { recursive: true, force: true })

  // Copy public files.
  fs.cpSync(`./${PUBLIC_DIR}`, `./${DIST_DIR}`, { recursive: true })

  // Copy index.html
  fs.cpSync(`./index.html`, `./${DIST_DIR}/index.html`)

  // Modified CSS plugin to extract CSS into separate files
  const cssPlugin = {
    name: 'css',
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, args => {
        // Handle both direct imports and aliased imports
        let fullPath: string
        if (args.path.startsWith('@/demo/')) {
          // Handle @/demo alias
          fullPath = path.resolve('./src', args.path.slice(7))
        } else if (args.path.startsWith('@/')) {
          // Handle other @ aliases
          fullPath = path.resolve('./src', args.path.slice(2))
        } else if (args.path.startsWith('styles/')) {
          // Handle styles alias
          fullPath = path.resolve('./src/styles', args.path)
        } else if (args.path.startsWith('./styles/')) {
          // Handle relative styles imports
          fullPath = path.resolve('./src/styles', args.path.slice(2))
        } else if (args.path.startsWith('/styles/')) {
          // Handle absolute styles imports
          fullPath = path.resolve('./src/styles', args.path.slice(1))
        } else {
          // Handle other relative imports
          fullPath = path.resolve(args.resolveDir, args.path)
        }
        return { path: fullPath, namespace: 'css-ns' }
      })

      build.onLoad({ filter: /.*/, namespace: 'css-ns' }, async (args) => {
        try {
          // Read the CSS file from its source location
          const css = await fs.promises.readFile(args.path, 'utf8')
          const filename = path.basename(args.path)
          const stylesDir = path.join(DIST_DIR, 'styles')
          
          // Ensure styles directory exists
          await fs.promises.mkdir(stylesDir, { recursive: true })
          
          // Write CSS to styles directory
          const outPath = path.join(stylesDir, filename)
          await fs.promises.writeFile(outPath, css)
          
          // Return a module that creates a link element to load the CSS
          return {
            contents: `
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = 'styles/${filename}';
              document.head.appendChild(link);
            `,
            loader: 'js'
          }
        } catch (error) {
          console.error(`Error processing CSS file ${args.path}:`, error)
          throw error
        }
      })
    }
  }

  // Build options
  const commonOptions: BuildOptions = {
    bundle    : true,
    minify    : !watch,
    sourcemap : true,
    target    : ['chrome58', 'firefox57', 'safari11', 'edge18'],
    alias     : {
      '@/demo': path.resolve('./src'),
      '@/hooks': path.resolve('./src/hooks'),
      '@/context': path.resolve('./src/context'),
      '@/store': path.resolve('./src/store'),
      '@/source': path.resolve('../dist/index.js'),
      '@/source/lib': path.resolve('../dist/lib/index.js'),
      '@/source/util': path.resolve('../dist/util/index.js'),
      '@/types': path.resolve('../dist/types/index.js'),
      'styles': path.resolve('./src/styles')
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
    external: [],
    loader: {
      '.tsx' : 'tsx',
      '.ts'  : 'ts',
      '.css' : 'css',
      '.png' : 'file',
      '.jpg' : 'file',
      '.svg' : 'file',
      '.gif' : 'file',
    },
    // Use relative paths for better compatibility
    publicPath: '',
    assetNames: '[name]-[hash]',
    // Add a plugin to handle image paths
    plugins: [{
      name: 'image-path',
      setup(build) {
        build.onResolve({ filter: /\.(png|jpg|svg|gif)$/ }, args => {
          if (args.path.startsWith('/')) {
            return {
              path: path.resolve('public', args.path.slice(1)),
              namespace: 'image-ns'
            }
          }
          return null
        })
      }
    }]
  }

  // Build app
  const appBuildOptions: BuildOptions = {
    ...commonOptions,
    entryPoints : ['src/index.tsx'],
    outfile     : `${DIST_DIR}/app.js`,
    format      : 'esm',
  }

  // Copy CSS files to dist
  const copyCssFiles = async () => {
    const srcStylesDir = path.join('src', 'styles')
    const distStylesDir = path.join(DIST_DIR, 'styles')
    
    // Ensure dist styles directory exists
    await fs.promises.mkdir(distStylesDir, { recursive: true })
    
    // Copy all CSS files
    const files = await fs.promises.readdir(srcStylesDir)
    for (const file of files) {
      if (file.endsWith('.css')) {
        const srcPath = path.join(srcStylesDir, file)
        const distPath = path.join(distStylesDir, file)
        await fs.promises.copyFile(srcPath, distPath)
      }
    }
  }

  if (watch) {
    // Use context API for watch mode
    const appContext = await esbuild.context({
      ...appBuildOptions,
      plugins: [cssPlugin]
    })
    
    // Watch CSS files
    const watchCssFiles = async () => {
      const srcStylesDir = path.join('src', 'styles')
      const distStylesDir = path.join(DIST_DIR, 'styles')
      
      // Ensure dist styles directory exists
      await fs.promises.mkdir(distStylesDir, { recursive: true })
      
      // Initial copy
      await copyCssFiles()
      
      // Watch for changes
      fs.watch(srcStylesDir, async (eventType, filename) => {
        if (filename && filename.endsWith('.css')) {
          console.log(`[ build ] CSS file changed: ${filename}`)
          const srcPath = path.join(srcStylesDir, filename)
          const distPath = path.join(distStylesDir, filename)
          await fs.promises.copyFile(srcPath, distPath)
        }
      })
    }
    
    await Promise.all([
      appContext.watch(),
      watchCssFiles()
    ])
    
    console.log('[ build ] watching for changes...')
  } else {
    // One-time build
    await Promise.all([
      esbuild.build({
        ...appBuildOptions,
        plugins: [cssPlugin]
      }),
      copyCssFiles()
    ])
    
    console.log('[ build ] build complete')
  }
}

// Run the build function and handle errors
build().catch(err => {
  console.error('[ build ] build failed:', err)
  process.exit(1)
})
