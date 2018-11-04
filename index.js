/**
* @momsfriendlydevco/agents
* This unit loads all *.agents.js files into the app.cache facility periodically
* It is a cross between a cron job and a caching module
* For example to load all widgets every 3 hours there should be a widgets.agents.js file which exports a callback which will get paged every 3 hours with a value, this is cached and can be returned via get()
*
* @example In the widgets.agents.js file
* module.exports = {
*   id: 'widgets',
*   timing: '0 * * * *', // Every hour
*   worker: (finish) => { complexOperation(finish) }
* };
* @example Somewhere else in the application
* agents.get('widgets', (err, value) => { ... });
*/

// NOTE: Since the agents.js module is loaded in different environments the following list is incomplete - scan the code for /require/ for the full list of deps
var _ = require('lodash').mixin(require('lodash-keyarrange'));
var argy = require('argy');
var async = require('async-chainable');
var colors = require('chalk');
var CronJob = require('cron').CronJob;
var cronTranslate = require('cronstrue').toString;
var fspath = require('path');
var glob = require('glob');
var humanize = require('humanize');
var readable = require('@momsfriendlydevco/readable');
var timestring = require('timestring');

var agents = {};
module.exports = agents;


// Config {{{
/**
* Agents config
*/
agents.config = {
	enabled: true,
	schedule: false,
	allowImmediate: true,
	context: { // Additional context functions to load
	},
	discovery: {
		autoInstall: true, // Whether any discovered agents should be installed as a cronjob
		paths: [], // Scan these globs when loading agent files
	},
	methods: {
		force: false,
		inline: true,
		pm2: true,
		aws: false,
	},
	cache: [
		()=> process.env.AGENT_LAMBDA ? 'redis' : undefined,
		()=> (agent, config) => agent.method == 'aws' ? 'redis' : undefined,
		'filesystem',
	],
	bootstrapper: {
		url: `http://someurl.com/api/agents/package.zip`,
		user: 'cho6Ahtohqua9Woogh7uhaeyiePhoo6iegaequ9hi0au1ongup2Eicaich6IeW2r',
		pass: 'paechake2aihuo8geeteutem6aibengauke5uGhice3yaithoowuzoph3fuphaig',
	},
};


/**
* Set a config key or merge a config object
* @param {string|array|object} key Either a single config key to set (with a value) or an object to merge over the existing config. Key can use dotted notation or array notation for deep keys
* @param {*} val The value if setting one key
* @returns {Agents} This chainable object
*/
agents.set = (key, val) => {
	if (_.isString(key)) {
		_.set(agents.config, key, val);
	} else {
		_.merge(agents.config, key);
	}
	return agents;
};
// }}}


// Initialization {{{
/**
* Bootstrap the main agent object (including refreshing the list of agents)
* NOTE: This automatically calls `agents.refresh()`
* @returns {Promise}
*/
agents.setup = finish =>
	async()
		// Load available agents (if we havn't already) {{{
		.then('agents', function(next) {
			if (agents._agents && !_.isEmpty(agents._agents)) return next(null, agents._agents);
			agents.refresh(next);
		})
		// }}}
		// Setup all jobs {{{
		.forEach('agents', function(next, agentWorker, id) {
			if (!agentWorker.timing || !agents.config.discovery.autoInstall) return next(); // No timing - don't bother registering

			agentWorker.cronJob = new CronJob({
				cronTime: agentWorker.timing,
				onTick: ()=> {
					console.log(colors.blue('[agents]'), 'Refreshing agent', colors.cyan(id), 'from cron timing', colors.cyan(agentWorker.timing), colors.grey(`(${cronTranslate(agentWorker.timing)})`));
					agents.run(id);
				},
				start: agents.config.schedule, // Means schedule the item in the cron queue, not actually run the tick
			});

			if (agents.config.schedule) console.log(colors.blue('[agents]'), 'Installed agent', colors.cyan(id), 'with timing', colors.cyan(agentWorker.timing), colors.grey(`(${cronTranslate(agentWorker.timing)})`));
			next();
		})
		// }}}
		// Run all agents marked as immediate {{{
		.forEach('agents', function(next, agentWorker, id) {
			if (!agentWorker.immediate || !agents.config.allowImmediate) return next();
			console.log(colors.blue('[agents]'), 'Agent', colors.cyan(id), 'marked for immediate run!');
			agents.run(id, next);
		})
		// }}}
		.then(function(next) {
			if (!agents.config.schedule) console.log(colors.blue('[agents]'), 'Agent scheduling is disabled');
			next();
		})
		.promise(finish);
// }}}

// Agent instances / loading {{{
/**
* Collection of agent services
* All are loaded from **.agent.js
* @var {Object <Object>} Object where all keys are the agen name (stripped of the `.agent.js` suffix), all values should be an object
* @param {function} worker The callback function to run when the agents timing expires
* @param {string} [timing] A cron compatible expression on when the agents should run. If omitted no cronJob is registered
* @param {string} [expires] How long the value should be retained (set this to something like '1h' if you dont want to recalc the value with custom settings each time)
* @param {string} id The ID of the agent to store in the cache
* @param {boolean} [hasReturn=true] Whether the agent is expected to return something
* @param {boolean} [immediate=false] Whether to run the agents as soon as the server is ready - should only be used for debugging purposes (only works if agents.config.allowImmediate is true)
* @param {array} [methods] Which methods are allowed to run the agent, these are processed in first->last priority order with the first matching being used
* @param {boolean} [show=false] Whether the agent should show up in the agent listing
* @param {boolean} [clearOnBuild=true] Whether the agent contents should invalidate on each build
* @param {CronJob} [cronJob] The CronJob object calculated from the timing string. Only available if timing is specified
*
* @this (Result of createContext()) Additional properties `cacheKey`, `method`, `cache` are available during run()
*/
agents._agents = {};


/**
* Load an agent, either by loading it from a file or directly from an object
* @param {string|Object} agent Either a path on disk to load the agent from or an Object matching the agent spec
* @returns {Agents} This chainable object
*/
agents.register = agent => {
};


/**
* Refresh all agent services
* @param {function} finish Callback to call when done as (err, agents)
*/
agents.refresh = function(finish) {
	async()
		// Glob all agents {{{
		.map('paths', _.castArray(agents.config.discovery.paths), function(next, path) {
			glob(path, next);
		})
		.then('paths', function(next) {
			next(null, _.flatten(this.paths));
		})
		// }}}
		// Assign all found agents to a lookup object {{{
		.then(function(next) {
			try {
				agents._agents = _(this.paths)
					.mapKeys(path => {
						var module = require(path);
						if (!module.id) console.log(colors.blue('[agents]'), colors.yellow('WARNING'), 'agent path', colors.cyan(path), 'does not have an ID or look like a valid agent - skipped');
						return module.id;
					})
					.mapValues(path => require(path))
					.mapValues((v, k) => _.set(v, 'context',  agents.createContext({
						id: k,
					})))
					.pickBy((v, k) => k !== 'undefined') // Only include agent that have a valid ID
					.value();

					next();
			} catch (e) {
				next(e);
			}
		})
		// }}}
		// Output list of loaded agents {{{
		.then(function(next) {
			console.log(colors.blue('[agents]'), 'Loaded agents', _.keys(agents._agents).sort().map(i => colors.cyan(i)).join(', '));
			next();
		})
		// }}}
		// End {{{
		.end(function(err) {
			if (err) return finish(err);
			finish(null, agents._agents);
		})
		// }}}
};
// }}}


/**
* Tracker for individual versions of agents + settings that are running
* @var {Object}
* @param {boolean} [isRunning] Whether the job is currently running
* @param {array <function>} [waiting] List of functions waiting for the result of the worker - register a callback into this if you want the next available result
*/
agents._running = {};


/**
* How long to pause between agent context logThrottled updates
* @var {number}
*/
agents._logThrottle = 250;




/**
* Check whether then given agent ID is valid
* @param {string} id The agent ID to check
* @returns {boolean} Whether the agent is valid
*/
agents.has = id => !! agents._agents[id];




/**
* Convenience function to retrieve an item thats been cached OR run the agents and get that result
* This function really just checks if a cache exists, if so it uses that, if not the worker is run then the result is cached + used
* @param {string} id The ID of the worker result to return
* @param {Object} [settings] Optional settings to pass to the agents
* @param {boolean} [settings.$has=false] Only return if we have a value, if not return undefined. If this value is false (default) the agent is run if no value exists
* @param {function} finish Callback to call as (err, result)
* @returns {Promise} A promise which resolves with the agent result or throws
*/
agents.get = argy('string [object] [function]', function(id, settings, finish) {
	// Sanity checks {{{
	if (!agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
	// }}}
	// Compute the cache key to use when communicating (if settings exists) {{{
	if (!settings) settings = {};
	var cacheKey = settings.$cacheKey || agents.getKey(id, settings);
	settings.$cacheKey = cacheKey;
	// }}}

	return new Promise((resolve, reject) => {
		async()
			// Determine run method {{{
			.then('method', function(next) {
				if (agents.config.methods.force) return next(null, agents.config.methods.force);
				if (!agents._agents[id].methods) return next(`Agent "${id}" has no execution methods specified`);
				var method = agents._agents[id].methods.find(m => agents.config.methods[m]);
				if (!method) return next('Cannot find available method to execute agent');
				next(null, method);
			})
			// }}}
			// Determine cache method {{{
			.then('cache', function(next) {
				if (!_.get(app, 'config.agents.cache')) return next('No cache method rules defined in agents.config.cache');
				var cache = agents.config.cache
					.map(rule => // Transform functions into their results
						_.isFunction(rule) ? rule(Object.assign({}, agents._agents[id], {method: this.method}))
						: rule
					)
					.find(rule => rule) // First non-undefined

				if (!cache) return next('Cannot find any cache to use based on rules defined in agents.config.cache');
				if (!app.caches[cache]) return next(`Need to use caching method "${cache}" but it is not loaded in app.caches`);
				next(null, cache);
			})
			// }}}
			// Try to access an existing cache value {{{
			.then('value', function(next) {
				if (!agents.config.enabled) {
					console.log(colors.blue('[agents]'), 'agent is disabled, forcing fresh value calculation each time!');
					return next();
				} else {
					app.caches[this.cache].get(cacheKey, next);
				}
			})
			// }}}
			// No cache value - run the worker {{{
			.then('value', function(next) {
				if (this.value !== undefined) return next(null, this.value);
				if (settings.$has) return next(null, null);
				agents.run(id, settings, next);
			})
			// }}}
			// End {{{
			.end(function(err) {
				if (err) {
					if (_.isFunction(finish)) finish(err);
					reject(err);
				} else {
					if (_.isFunction(finish)) finish(null, this.value);
					resolve(this.value);
				};
			})
			// }}}
	});
});


/**
* Convenience function to submit a job and immediately return its jobToken (really a cacheKey) but not block-wait for it to complete
* @param {string} id The ID of the worker result to return
* @param {Object} [settings] Optional settings to pass to the agents
* @param {function} finish Callback to call as `(err, {jobToken})`
*/
agents.jobSubmit = argy('string [object] function', function(id, settings, finish) {
	// Sanity checks {{{
	if (!agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
	// }}}
	// Compute the cache key to use when communicating (if settings exists) {{{
	if (!settings) settings = {};
	var cacheKey = settings.$cacheKey || agents.getKey(id, settings);
	// }}}

	async()
		// Determine run method {{{
		.then('method', function(next) {
			if (agents.config.methods.force) return next(null, agents.config.methods.force);
			if (!agents._agents[id].methods) return next(`Agent "${id}" has no execution methods specified`);
			var method = agents._agents[id].methods.find(m => agents.config.methods[m]);
			if (!method) return next('Cannot find available method to execute agent');
			next(null, method);
		})
		// }}}
		// Determine cache method {{{
		.then('cache', function(next) {
			if (!_.get(app, 'config.agents.cache')) return next('No cache method rules defined in agents.config.cache');
			var cache = agents.config.cache
				.map(rule => // Transform functions into their results
					_.isFunction(rule) ? rule(Object.assign({}, agents._agents[id], {method: this.method}))
					: rule
				)
				.find(rule => rule) // First non-undefined

			if (!cache) return next('Cannot find any cache to use based on rules defined in agents.config.cache');
			if (!app.caches[cache]) return next(`Need to use caching method "${cache}" but it is not loaded in app.caches`);
			next(null, cache);
		})
		// }}}
		// Try to access an existing cache value {{{
		.then('exists', function(next) {
			app.caches[this.cache].has(cacheKey, next);
		})
		// }}}
		// Erase the job progress (if it doesnt already exist as a cache value) {{{
		.then(function(next) {
			if (!this.exists) return next();
			app.caches[this.cache].unset(cacheKey + '-progress', next);
		})
		// }}}
		// Submit the job if it doesn't already exist {{{
		.then(function(next) {
			if (this.exists) {
				console.log(colors.blue(`[agents / ${cacheKey}]`), 'job already has value - skipping submission');
				return next(); // Job return already exists
			} else {
				console.log(colors.blue(`[agents / ${cacheKey}]`), 'job submitted');
				agents.run(id, settings);
				next(); // NOTE: We do NOT wait for the agent to finish
			}
		})
		// }}}
		// End {{{
		.end(function(err) {
			if (err) return finish(err);
			finish(null, {jobToken: cacheKey});
		})
		// }}}
});


/**
* Query a submitted jobToken (really a cacheKey) and return its status
* NOTE: Since this function is likely to be paged frequently it should have minimal overhead
* @param {string} jobToken The jobToken to query
* @param {function} finish Callback to call as `(err, {jobToken, status: pending|completed})`
*/
agents.jobStatus = argy('string function', function(jobToken, finish) {
	async()
		.parallel({
			// Scan all caches for an update about this job return value {{{
			isFound: function(next) {
				async()
					.set('isFound', false)
					.forEach(_.keys(app.caches), function(next, cache) {
						app.caches[cache].has(jobToken, (err, result) => {
							if (err) return next(err);
							if (result === true) this.isFound = true;
							next();
						});
					})
					.end('isFound', next)
			},
			// }}}
			// Scan the responding caches for an (optional) progress update {{{
			progress: function(next) {
				async()
					.set('progress', false)
					.forEach(_.keys(app.caches), function(next, cache) {
						app.caches[cache].get(jobToken + '-progress', (err, result) => {
							if (err || !result) return next(); // No response or error - ignore and continue
							this.progress = result;
							next();
						});
					})
					.end('progress', next)
			},
			// }}}
		})
		.end(function(err) {
			if (err) return finish(err);
			finish(null, {
				jobToken,
				status: this.isFound ? 'completed' : 'pending',
				progress: this.progress,
			});
		})
});


/**
* Returns the result from a jobToken
* Really this just searches all caches for the first matching cacheKey and fetches that
* @param {string} jobToken The jobToken to search for
* @param {function} finish Callback called as (err, result) when complete
*/
agents.jobFetch = argy('string function', function(jobToken, finish) {
	async()
		.map('results', _.keys(app.caches), function(next, cache) {
			app.caches[cache].get(jobToken, (err, result) => {
				if (err) return next(err);
				if (result === undefined) return next();
				next(null, result);
			});
		})
		.then('result', function(next) {
			next(null, _(this.results)
				.filter()
				.first()
			);
		})
		.end(function(err) {
			if (err) return finish(err);
			finish(null, this.result);
		})
});


/**
* Compute a unique hashed key from a combination of the ID and settings object
* NOTE: Any key beginning with '$' is omitted
* @param {string} id The ID of the worker
* @param {Object} [settings] Optional settings structure
*/
agents.getKey = function(id, settings) {
	var hashable = _(settings)
		.pickBy((v, k) => !k.startsWith('$'))
		.keyArrangeDeep()
		.value()

	return _.isEmpty(hashable)
		? id
		: id + '-' + app.cache.hash(hashable)
};


/**
* Create a worker context for the specified agent
* The context gets attached to agents._agents[id].context when refresh() is called
* @param {Object} settings Settings object used to create the worker
* @param {string} settings.id The ID of the worker
* @return {Object} A context object used to call the agent worker() function
*/
agents.createContext = (settings) => {
	var context = {};

	// Basic logging {{{
	Object.assign(context, {
		colors: colors,
		log: (...msg) => console.log.apply(this, [colors.blue(`[agents / ${settings.id}]`)].concat(msg)),
		logThrottled: _.throttle((...msg) => console.log.apply(this, [colors.blue(`[agents / ${settings.id}]`)].concat(msg)), agents._logThrottle),
		warn: (...msg) => console.log.apply(this, [colors.blue(`[agents / ${settings.id}]`), colors.yellow('WARNING')].concat(msg)),
	});
	// }}}

	// Progress reporting {{{
	Object.assign(context, {
		progressMax: undefined,
		progressCurrent: undefined,
		progressText: undefined,
		progress: argy('[string] number [number]', function(text, current, max) {
			if (text && !current && !max) { // Reset progress markers?
				context.progressText = text;
				context.progressCurrent = undefined;
				context.progressMax = undefined;
			} else {
				if (text) context.progressText = text;
				if (current) context.progressCurrent = current;
				if (max) context.progressMax = max;
			}

			var output;

			this.progressCacheUpdate(); // Throttled progress write to cache (if we have a cache set)

			if (context.progressMax == 100) { // Already provided as a percentage
				context.logThrottled(colors.bold(context.progressText || 'Progress') + ':', colors.cyan(Math.floor(context.progressCurrent) + '%'));
			} else if (!_.isUndefined(context.progressCurrent) && !_.isUndefined(context.progressMax)) { // Provided some ranged number
				context.logThrottled(colors.bold(context.progressText || 'Progress') + ':', colors.cyan(context.progressCurrent), '/', colors.cyan(context.progressMax), colors.grey('(' + Math.ceil(context.progressCurrent / context.progressMax * 100) + '%)'));
			} else if (!_.isUndefined(context.progressMax)) { // Provided as some arbitrary number
				context.logThrottled(colors.bold(context.progressText || 'Progress') + ':', colors.cyan(context.progressCurrent), '/', colors.cyan(context.progressMax), colors.grey('(' + Math.ceil(context.progressCurrent / context.progressMax * 100) + '%)'));
			} else if (!_.isUndefined(context.progressText)) { // Only have text
				context.log(colors.bold(context.progressText));
			}
		}),
		progressCacheUpdate: _.throttle(function(text, current, max) {
			if (!this.cache) return; // We don't have a cache accessibe - skip
			app.caches[this.cache].set(
				this.cacheKey + '-progress',
				{text: context.progressText, current: Math.ceil(context.progressCurrent / context.progressMax * 100)},
				Date.now() + 1000 * 60 * 30 // Clean up after 30m
			);
		}, agents._logThrottle),
	});
	// }}}

	// Custom supplied contexts {{{
	Object.assign(context, agents.config.context);
	// }}}

	return context;
};


/**
* Run the worker and cache the result
*
* WARNING: You almost always want the agents.get() function instead of agents.run()
*          This function will ALWAYS run the agent, whereas get() provides a cached result if there is one
*
* @param {string} id The ID of the worker result to return
* @param {Object} [settings] Optional settings to pass to the agents
* @param {boolean} [settings.$enclose=false] Never throw an error, instead enclose it as a return value of the form `{error: String}`
* @param {string} [settings.$cacheKey] Key to force when storing the result
* @param {string} [settings.$cache] Which caching method to use
* @param {function} finish Callback to call as (err, result)
* @returns {Promise} Promise with result or thrown error
*/
agents.run = argy('string [object] [function]', function(id, settings, finish) {
	// Sanity checks {{{
	if (!agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
	// }}}
	// Compute the cache key to use when communicating (if settings exists) {{{
	if (!settings) settings = {};
	var cacheKey = settings.$cacheKey || agents.getKey(id, settings);
	settings.$cacheKey = cacheKey;
	// }}}

	// If the agents is already running - queue the callback for when the worker completes {{{
	if (_.get(agents, ['_running', cacheKey, 'isRunning'])) { // Is there already a worker running? If so register as waiting and exit
		if (_.isFunction(finish)) {
			console.log(colors.blue(`[agents / ${cacheKey}]`), 'Request to run already executing agent', colors.cyan(id), 'queued');
			if (!agents._running[cacheKey].waiting) agents._running[cacheKey].waiting = [];
			 agents._running[cacheKey].waiting.push(finish);
		} else {
			console.log(colors.blue(`[agents / ${cacheKey}]`), 'Request to run already executing agent', colors.cyan(id), 'no callback was passed so this request is ignored');
		}
		return agents._running[cacheKey].promise;
	} else {
		agents._running[cacheKey] = {isRunning: true, promise: undefined}; // Promise is setup below
	}
	// }}}

	return agents._running[cacheKey].promise = new Promise((resolve, reject) => {
		async()
			.set('startTime', Date.now())
			// Determine run method {{{
			.then('method', function(next) {
				if (agents.config.methods.force) return next(null, agents.config.methods.force);
				if (!agents._agents[id].methods) return next(`Agent "${id}" has no execution methods specified`);
				var method = agents._agents[id].methods.find(m => agents.config.methods[m]);
				if (!method) return next('Cannot find available method to execute agent');
				next(null, method);
			})
			// }}}
			// Determine cache method {{{
			.then('cache', function(next) {
				if (!_.get(app, 'config.agents.cache')) return next('No cache method rules defined in agents.config.cache');
				var cache = agents.config.cache
					.map(rule => // Transform functions into their results
						_.isFunction(rule) ? rule(Object.assign({}, agents._agents[id], {method: this.method}))
						: rule
					)
					.find(rule => rule) // First non-undefined

				if (!cache) return next('Cannot find any cache to use based on rules defined in agents.config.cache');
				if (!app.caches[cache]) return next(`Need to use caching method "${cache}" but it is not loaded in app.caches`);
				next(null, cache);
			})
			.then(function(next) {
				console.log(colors.blue(`[agents / ${cacheKey}]`), 'Using method', colors.cyan(this.method), agents.config.methods.force ? colors.grey('(forced)') : '');
				console.log(colors.blue(`[agents / ${cacheKey}]`), 'Using cache', colors.cyan(this.cache));
				next();
			})
			// }}}
			.then('value', function(next) {
				switch (this.method) {
					// Inline (and main) task runner {{{
					// Even though this is listed as a method every task eventually hits this as the endpoint
					case 'inline':
						console.log(colors.blue(`[agents / ${cacheKey}]`), 'Running agent', colors.cyan(id), '(inline)...');

						async()
							.set('cache', this.cache)
							.set('method', this.method)
							// Create run context {{{
							.then('runContext', function(next) {
								next(null, Object.assign({}, agents._agents[id].context, {
									cacheKey,
									method: this.method,
									cache: this.cache,
								}));
							})
							// }}}
							// Erase current progress marker {{{
							.then(function(next) {
								app.caches[this.cache].unset(cacheKey + '-progress', next);
							})
							// }}}
							// Run the worker {{{
							.then('value', function(next) {
								async.run(this.runContext, agents._agents[id].worker, (err, value) => {
									if (err && settings.$enclose) {
										this.runContext.log('Caught error, enclosing');
										value = {error: err.toString()};
										err = undefined;
									} else if (err) {
										return next(err);
									}

									// Stash the calculated result in the cache
									if (!agents.config.enabled) { // Caching disabled
										next(null, value);
									} else if (_.isString(agents._agents[id].expires) && agents._agents[id].expires) { // Stash value with an expiry
										var expiry = new Date(Date.now() + (timestring(agents._agents[id].expires) * 1000));
										this.runContext.log(`Stashing result with expiry of ${expiry}`);
										var stashStart = new Date();
										app.caches[this.cache].set(cacheKey, value, expiry, err => {
											this.runContext.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
											if (err) return next(err);
											next(null, value);
										});
									} else { // Stash value with no expiry
										this.runContext.log('Stashing result with no expiry');
										var stashStart = new Date();
										app.caches[this.cache].set(cacheKey, value, err => {
											this.runContext.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
											if (err) return next(err);
											next(null, value);
										});
									}
								}, [settings || {}]);
							})
							// }}}
							// Remove the progress indicator for the completed job {{{
							.then(function(next) {
								// NOTE: We have to wait for this as the process may terminate if we're in a lambda - we can't unset in the background
								app.caches[this.cache].unset(cacheKey + '-progress', next);
							})
							// }}}
							.end('value', next);

						break;
					// }}}

					// PM2 ("pm2") delegated task runner {{{
					case 'pm2':
						var pm2 = require('pm2');
						async()
							.set('procName', `agent-${app.config.theme.code || app.config.name}-${cacheKey}`)
							.set('cache', this.cache)
							// Connect to PM2 {{{
							.then('pm2', function(next) {
								pm2.connect(next);
							})
							// }}}
							// Check if the process is already registered {{{
							.then(function(next) {
								pm2.describe(this.procName, (err, proc) => {
									if (err || !proc || !proc.length || _.isEqual(proc, [[]]) || _.isEqual(proc, [])) return next(); // Process doesn't exist - continue on
									var status = _.get(proc, '0.pm2_env.status');
									console.log(colors.blue(`[agents / ${cacheKey}]`), 'Process', colors.cyan(this.procName), 'already exists and has the status', colors.cyan(status), 'terminating...');
									pm2.delete(this.procName, ()=> next());
								});
							})
							// }}}
							// Create the process {{{
							.then('pid', function(next) {
								console.log(colors.blue(`[agents / ${cacheKey}]`), 'Spawning PM2 process', colors.cyan(this.procName));
								pm2.start(`${app.config.paths.root}/run-agent`, {
									name: this.procName,
									args: [id], // NOTE: This doesn't work due to the way that PM2 wraps the node script
									cwd: app.config.paths.root,
									env: {
										NODE_ENV: app.config.env,
										AGENT: id,
										AGENT_SETTINGS: JSON.stringify(settings),
										AGENT_CACHE: this.cache,
									},
									autorestart: false,
									interpreter: 'node',
									interpreterArgs: ['--max-old-space-size=12288'],
								}, (err, proc) => {
									if (err) return next(err);
									// Wait at least one second before continuing
									next(null, proc[0].process.pid);
								});
							})
							// }}}
							// Poll the process until it finishes {{{
							.then(function(next) {
								var startTick = Date.now();
								var checkProcess = ()=> {
									pm2.describe(this.procName, (err, proc) => {
										if (err) return next(err);
										var status =
											_.isEqual(proc, [[]]) && _.isEqual(proc, []) ? 'stopped'
											: _.has(proc, '0.pm2_env.status') ? proc[0]['pm2_env'].status
											: 'unknown';

										switch (status) {
											case 'launching':
											case 'online': // Still running - wait and try again
												console.log(colors.blue(`[agents / ${cacheKey}]`), 'Waiting for PM2 process', colors.cyan(this.procName), 'to complete', colors.grey(readable.relativeTime(startTick)));
												setTimeout(checkProcess, 1000);
												break;
											case 'stopping':
											case 'stopped':
												next();
												break;
											case 'errored':
												next('PM2 process errored out');
												break;
											case 'unknown':
												console.log(`Error: When asked to describe proc "${this.procName}", PM2 gave back:`);
												console.log(require('util').inspect(proc, {depth: null, colors: true}))
												next('Unknown PM2 process status');
												break;
											default:
												next(`Unknown PM2 status: ${status}`);
										}
									});
								};
								setTimeout(checkProcess, 1000);
							})
							// }}}
							.parallel({
								// Scoop the computed value from the cache {{{
								value: function(next) {
									app.caches[this.cache].get(cacheKey, next);
								},
								// }}}
								// Clean up the PM2 process {{{
								pm2Cleaner: function(next) {
									pm2.delete(this.procName, err => {
										if (err) console.log(colors.blue(`[agents / ${cacheKey}]`), colors.yellow('WARNING'), 'Error cleaning up process', colors.cyan(this.procName), '-', err);
										next();
									});
								},
								// }}}
							})
							// Disconnect and continue into outer handler {{{
							.end(function(err) {
								if (this.pm2) pm2.disconnect();

								if (err) {
									console.log(colors.blue(`[agents / ${cacheKey}]`), 'PM2 process creation error', err);
									next(err);
								} else if (_.isObject(this.value) && _.keys(this.value).length == 1 && this.value.error) { // Is the sub-process returning an error object instead?
									// NOTE: We have to work around this as sub-process agent can only return a value not an error object
									next(this.value.error);
								} else {
									next(null, this.value);
								}
							})
							// }}}

						break;
					// }}}

					// Amazon Batch ("aws") task running {{{
					case 'aws':
						if (!_.has(app, 'config.aws')) return next('app.config.aws is missing');
						if (!_.has(app, 'config.agents.bootstrapper.url')) return next('config.agents.bootstrapper.url is missing');
						var aws = require('aws-sdk');
						aws.config.update(app.config.aws.config);

						var batch = new aws.Batch({apiVersion: '2016-08-10'});

						async()
							.set('jobName', `agent-${app.config.theme.code || app.config.name}-${id}`)
							.set('cache', this.cache)
							// Submit the job {{{
							.then('job', function(next) {
								batch.submitJob({
									jobDefinition: _.get(app, 'config.aws.batch.jobDefinition', 'doop-agent'),
									jobName: this.jobName,
									jobQueue: _.get(app, 'config.aws.batch.queue', 'doop-agents-queue'),
									containerOverrides: {
										environment: [
											{name: 'DA_URL', value: agents.config.bootstrapper.url},
											{name: 'DA_URL_USER', value: agents.config.bootstrapper.user},
											{name: 'DA_URL_PASS', value: agents.config.bootstrapper.pass},
											{name: 'DA_AGENT', value: id},
											{name: 'DA_AGENT_SETTINGS', value: JSON.stringify(settings)},
											{name: 'DA_CACHE', value: this.cache},
											{name: 'DA_ENV', value: app.config.env},
										],
									},
									timeout: {
										attemptDurationSeconds: _.get(app, 'config.aws.batch.timeout', 60 * 30), // 30 minutes
									},
								}, next);
							})
							.then(function(next) {
								console.log(colors.blue(`[agents / ${cacheKey}]`), 'Spawning AWS job', this.job.jobName, colors.grey('(ID: ' + this.job.jobId + ')'));
								next();
							})
							// }}}
							// Check the status of the batch job until it completes {{{
							.then(function(next) {
								var startTick = Date.now();
								var checkJob = ()=> {
									batch.describeJobs({
										jobs: [this.job.jobId],
									}, (err, data) => {
										if (err) return next(err);

										var job = data.jobs[0];
										switch (job.status || 'unknown') {
											case 'SUBMITTED':
											case 'PENDING':
											case 'RUNNING':
											case 'RUNNABLE':
											case 'STARTING':
												// Still running - wait and try again
												console.log(colors.blue(`[agents / ${cacheKey}]`), 'Waiting for', colors.cyan(job.status.toLowerCase()), 'AWS Batch job', colors.cyan(job.jobId), 'to complete', colors.grey(readable.relativeTime(startTick)));
												setTimeout(checkJob, job.status == 'RUNNABLE' ? 5000 : 1000);
												break;
											case 'SUCCEEDED':
												console.log(colors.blue(`[agents / ${cacheKey}]`), 'AWS Batch job', colors.cyan(job.jobId), 'completed');
												next();
												break;
											case 'FAILED':
												next('AWS Batch job errored out');
												break;
											case 'unknown':
												console.log(`Error: When asked to describe proc "${this.procName}", AWS Batch gave back:`);
												console.log(require('util').inspect(job, {depth: null, colors: true}))
												next('Unknown AWS Batch job status');
												break;
											default:
												next(`Unknown AWS Batch job status: ${job.status}`);
										}
									});
								};
								setTimeout(()=> checkJob(), 1000);
							})
							// }}}
							// Slurp in the cache value {{{
							.then('value', function(next) {
								app.caches[this.cache].get(cacheKey, next);
							})
							// }}}
							.end('value', next);

						break;
					// }}}

					// Google Compute Engine ("gce") {{{
					// }}}

					// Unknown task runner {{{
					default:
						throw new Error(`Unknown task agent method: "${agents.config.method}"`);
					// }}}
				}
			})
			.end(function(err) {
				// Show status on the console {{{
				if (err) {
					console.log(colors.blue(`[agents / ${cacheKey}]`), colors.red('ERROR'), 'agent', colors.cyan(id), 'threw:', err);
					this.value = null;
				} else if (this.value === false) { // Trap `false` as a special 'I dont want to save anything' result

					console.log(colors.blue(`[agents / ${cacheKey}]`), 'agent', colors.cyan(id), 'finished in', colors.cyan(readable.relativeTime(this.startTime, {units: {milliseconds: true}})), colors.grey('(agent has no cachable payload)'));
				} else {
					if (agents._agents[id].hasReturn === false) console.log(colors.blue(`[agents / ${cacheKey}]`), 'agent', colors.cyan(id), 'specifies that it has no return (via `hasReturn`) but provided a value - check this!');
					console.log(colors.blue(`[agents / ${cacheKey}]`), 'agent', colors.cyan(id), 'finished in', colors.cyan(readable.relativeTime(this.startTime, {units: {milliseconds: true}})), 'with an object size of', colors.cyan(readable.fileSize(readable.sizeOf(this.value))));
					if (!this.value) err = `Agent ${id} returned an empty value!`;
				}
				// }}}

				// Fire callbacks for all callbacks registered against this agents {{{
				var peerCallbacks = agents._running[cacheKey].waiting || [];
				delete agents._running[cacheKey];

				if (err) {
					// Call this callback if its interested in the result
					if (_.isFunction(finish)) finish(err);

					// Call any other callbacks that are interested in the result
					peerCallbacks.forEach(cb => cb(err));
					reject(err);
				} else {
					// Call this callback if its interested in the result
					if (_.isFunction(finish)) finish(null, this.value);

					// Call any other callbacks that are interested in the result
					peerCallbacks.forEach(cb => cb(null, this.value));
					resolve(this.value);
				}
				// }}}
			});
	});
});


/**
* Clear the cache contents for a given agent
*/
agents.invalidate = argy('string [object] [function]', function(id, settings, finish) {
	// Sanity checks {{{
	if (!agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
	// }}}
	// Compute the cache key to use when communicating (if settings exists) {{{
	if (!settings) settings = {};
	var cacheKey = settings.$cacheKey || agents.getKey(id, settings);
	// }}}

	async()
		// Determine run method {{{
		.then('method', function(next) {
			if (agents.config.methods.force) return next(null, agents.config.methods.force);
			if (!agents._agents[id].methods) return next(`Agent "${id}" has no execution methods specified`);
			var method = agents._agents[id].methods.find(m => agents.config.methods[m]);
			if (!method) return next('Cannot find available method to execute agent');
			next(null, method);
		})
		// }}}
		// Determine cache method {{{
		.then('cache', function(next) {
			if (!_.get(app, 'config.agents.cache')) return next('No cache method rules defined in agents.config.cache');
			var cache = agents.config.cache
				.map(rule => // Transform functions into their results
					_.isFunction(rule) ? rule(Object.assign({}, agents._agents[id], {method: this.method}))
					: rule
				)
				.find(rule => rule) // First non-undefined

			if (!cache) return next('Cannot find any cache to use based on rules defined in agents.config.cache');
			if (!app.caches[cache]) return next(`Need to use caching method "${cache}" but it is not loaded in app.caches`);
			next(null, cache);
		})
		// }}}
		// Invalidate the cache {{{
		.then(function(next) {
			app.caches[this.cache].unset(cacheKey, next);
		})
		// }}}
		.end(finish);
});


/**
* Retrieve a list of all agents with meta information
* NOTE: The agent ID's returned are stipped of the prefix / suffixs added by the caching module
* @param {function} finish Callback to call as (err, res)
*/
agents.list = argy('function', function(finish) {
	async()
		.parallel({
			agents: function(next) {
				next(null, agents._agents);
			},
			cacheContents: function(next) {
				async()
					.map('items', _.keys(app.caches), function(next, id) {
						app.caches[id].list(next);
					})
					.then('items', function(next) {
						next(null, _.flatten(this.items));
					})
					.end('items', next);
			},
		})
		.map('agents', 'agents', function(next, agent) {
			// Create basic return
			var cacheKey = app.config.middleware.cache.keyMangle(agent.id);
			var res = {
				id: agent.id,
				cacheKey: cacheKey,
				timing: agent.timing,
				hasReturn: agent.hasReturn,
				show: agent.show,
				methods: agent.methods,
				expiresString: agent.expires || false,
				expires: _.isString(agent.expires) && agent.expires ? timestring(agent.expires) * 1000 : false,
			};

			if (res.timing) res.timingString = cronTranslate(res.timing);

			var matchingCache = this.cacheContents.find(cc => cc.id == cacheKey);
			if (matchingCache) _.assign(res, _.omit(matchingCache, 'id'));

			next(null, res);
		})
		.end(function(err) {
			if (err) return finish(err);
			finish(null, _.values(this.agents));
		});
});
