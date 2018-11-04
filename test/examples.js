var agents = require('..');
var expect = require('chai').expect;

describe('agents.setup() - using examples', ()=> {

	before('it should load the example agents', ()=>
		agents
			.set('discovery.paths', [`${__dirname}/../examples/*.js`])
			.setup()
	);

	it('should have found some example agents to load', ()=> {
		expect(agents._agents).to.have.property('primes');
		expect(agents._agents.primes).to.have.property('id', 'primes');
		expect(agents._agents.primes).to.have.property('hasReturn', true);
	})

});
