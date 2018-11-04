var _ = require('lodash');
var gulp = require('gulp');
var gutil = require('gulp-util');
var fs = require('fs');
var readable = require('@momsfriendlydevco/readable');
var promisify = require('util').promisify;
var zip = require('gulp-vinyl-zip');

gulp.task('agents', ['agents:package', 'agents:build:clear']);


/**
* Load the app.agents structure
*/
gulp.task('load:app.agents', ['load:app'], done => {
	app.agents = require(`${app.config.paths.root}/units/core.agents/agents`);
	app.agents._autoInstall = false;
	app.agents.setup(done);
});


/**
* Build the agents package.zip transport file
*/
gulp.task('agents:package', ['load:app'], ()=>
	gulp.src([
		'run-agent',
		'package.json',
		'config/*.conf.js',
		'units/core/backend.js',
		'units/core.agents/agents.js',
		'units/core.db/loader.js',
		'units/core.logging/loader.js',
		'units/core.sentry/loader.js',
		'units/middleware.cache/loader.js',
		'units/vendors.promises/loader.js',
		'units/**/*.agent.js',
		'units/**/*.schm.js',
		'units/lib/**/*.js',

		// Exclusions
		'!units/core.db.autoIndexer/**/*',
		'!units/shortner/**/*',
	], {
		base: app.config.paths.root,
	})
		.pipe(zip.dest(`${app.config.paths.root}/build/agents-package.zip`))
		.on('end', ()=> {
			gutil.log('total agent package size:', gutil.colors.cyan(readable.fileSize(fs.statSync(`${app.config.paths.root}/build/agents-package.zip`).size)));
		})
);


/**
* Erase the cache contents for any agent that has `{clearOnBuild: true}`
*/
gulp.task('agents:build:clear', ['load:app.agents', 'load:app.cache'], ()=>
	Promise.all(
		_(app.agents._agents)
			.keys()
			.filter(id => app.agents._agents[id].clearOnBuild)
			.map(id => promisify(app.agents.invalidate)(id))
	)
);
