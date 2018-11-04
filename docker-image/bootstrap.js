/**
* Doop-Agent Docker bootstrap script
*
* This script performs the following actions:
* 1. Access the URL stored as `process.env.DA_URL` and process the contents as JSON
* 2. Extract the contents _over_ the current profile
* 3. Run `npm install` to update the package pre-reqs
* 4. Run `./run-agent` (without arguments, but populating various environment variables from the below `DA_*` prefixes
*
* @param {string} process.env.DA_URL The URL to pull the zip for the minimal agent environment
* @param {string} [process.env.DA_URL_USER] Username to use when accessing DA_URL
* @param {string} [process.env.DA_URL_PASS] Password to use when accessing DA_URL
* @param {string} [process.env.DA_CACHE] Caching driver to use
* @param {string} process.env.DA_AGENT The agent name to run when the environment is ready
* @param {string} [process.env.DA_AGENT_SETTINGS] Optional JSON settings to pass to the agent
* @param {string} [process.env.DA_ENV] Parameter to pass to the agent as the NODE_ENV string downstream
*/

var colors = require('chalk');
var fs = require('fs');
var spawn = require('child_process').spawn;
var superagent = require('superagent');
var unzip = require('unzipper');
var util = require('util');

console.logRaw = console.log;
console.log = (...args) => console.logRaw.apply(this, [colors.blue('[bootstrapper]'), ...args]);
console.stage = (...args) => {
	console.stageStartTime = Date.now();
	console.logRaw.apply(this, [colors.blue('[bootstrapper]'), colors.yellow('Stage'), ...args]);
};
console.stageEnd = ()=> console.logRaw.apply(this, [colors.blue('[bootstrapper]'), colors.yellow('Stage finished'), colors.grey(Date.now() - console.stageStartTime + 'ms')]);

Promise.resolve()
	// Sanity checks {{{
	.then(()=> {
		console.stage('Sanity checks');
		if (!process.env.DA_URL) throw new Error('Environment variable DA_URL is missing');
		if (!process.env.DA_AGENT) throw new Error('Environment variable DA_AGENT is missing');
	})
	// }}}
	// Remove our own package.json file - as we will replace it with the downloaded one {{{
	.then(()=> util.promisify(fs.unlink)('./package.json'))
	// }}}
	// Fetch DA_URL + pipe though unzip {{{
	.then(()=> new Promise((resolve, reject) => {
		console.stage('GET', process.env.DA_URL, process.env.DA_URL_USER || process.env.DA_URL_PASS ? '(using basic auth)' : '');
		superagent.get(process.env.DA_URL)
			.auth(process.env.DA_URL_USER, process.env.DA_URL_PASS)
			.end((err, res) => {
				if (err) return reject(err);
				res.pipe(unzip.Extract({path: __dirname}))
					.on('error', reject)
					.on('close', ()=> resolve())
			})
	}))
	// }}}
	// Show root directory contents {{{
	.then(()=> util.promisify(fs.readdir)(__dirname))
	.then(contents => console.log('App root contents:', contents.join(', ')))
	// }}}
	// Run `npm install` to pull in dependencies {{{
	.then(()=> { // Determine packages we would install
		try {
			var packages = require('./package.json');
			var packagesBlacklist = require('./package-blacklist.json');
			var packagesWhitelist = require('./package-whitelist.json');
		} catch (e) {
			throw new Error('Cannot open or parse ./package.json, ./package-blacklist.json or ./package-whitelist.json');
		}

		// Cheap way to parse all blacklisted packages from a glob into an array of RegExps
		packagesBlacklist.dependencies = packagesBlacklist.dependencies.map(p => new RegExp('^' + p.replace('*', '.*') + '$'));
		packagesWhitelist.dependencies = packagesWhitelist.dependencies.map(p => new RegExp('^' + p.replace('*', '.*') + '$'));

		var startCount = Object.keys(packages.dependencies).length;
		var installPackages = Object.keys(packages.dependencies)
			.filter(p => packagesWhitelist.dependencies.some(white => white.test(p)) || !packagesBlacklist.dependencies.some(black  => black.test(p))) // Remove any that match the blacklist filter (but not the whitelist)
			.map(p => p + '@' + packages.dependencies[p]) // Add version to end of string

		console.log('Will install', colors.cyan(installPackages.length), 'packages', colors.grey(`(filtered out ${startCount - installPackages.length} as blacklisted)`));
		console.log('Packages:', installPackages.join(', '));

		return installPackages;
	})
	.then(packages => new Promise((resolve, reject) => {
		console.stage('npm install');
		spawn('npm', [
			'install',
			'--unsafe-perm',
			'--no-progress',
			'--audit=false',
			'--loglevel=http',
		].concat(packages), {
			cwd: __dirname,
			stdio: 'inherit',
			env: process.env,
		})
			.on('error', reject)
			.on('close', code => {
				if (code != 0) reject(`Unexpected exit code: ${code}`);
				console.stageEnd();
				resolve();
			})
	}))
	// }}}
	// Run the extracted agent (via `run-agent`) {{{
	.then(()=> new Promise((resolve, reject) => {
		console.stage('run-agent');
		spawn('node', ['run-agent'], {
			cwd: __dirname,
			stdio: 'inherit',
			env: Object.assign({}, process.env, {
				AGENT: process.env.DA_AGENT,
				AGENT_LAMBDA: '1',
				AGENT_CACHE: process.env.DA_CACHE,
				AGENT_SETTINGS: process.env.DA_AGENT_SETTINGS,
				NODE_ENV: process.env.DA_ENV,
			}),
		})
			.on('error', reject)
			.on('close', code => {
				if (code != 0) reject(`Unexpected exit code: ${code}`);
				resolve();
			})
	}))
	// }}}
	// Complete {{{
	.then(()=> {
		console.stage('halt');
		process.exit(0);
	})
	// }}}
	// Catch {{{
	.catch(err => {
		console.log('ERROR');
		console.log(err);
		process.exit(1);
	})
	// }}}
