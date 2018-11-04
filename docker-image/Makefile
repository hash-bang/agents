default: build

build:
	gulp agents
	docker build -t momsfriendlydevco/doop-agent .

run:
	docker run momsfriendlydevco/doop-agent

push:
	docker push momsfriendlydevco/doop-agent

test-docker: build
	docker run \
		-e 'DA_URL=http://localhost/api/agents/package.zip' \
		-e 'DA_URL_USER=ke9bi4Yae0aeg0Thamee4vaiR1aephe8diexeugheipiefui2uPeinae7ohzai0I' \
		-e 'DA_URL_PASS=xaequoghaizieje6aj5ohGoo7qua4bahh8xecaeThei8shaHalai0UGhoot2ahzi' \
		-e 'DA_AGENT=primes' \
		--network host \
		momsfriendlydevco/doop-agent

test-node:
	@DA_URL=http://localhost/api/agents/package.zip \
	DA_AGENT=primes \
	node ./bootstrap.js

push-gcloud:
	docker tag momsfriendlydevco/doop-agent asia.gcr.io/forward-subject-167623/doop-agent
	docker push asia.gcr.io/forward-subject-167623/doop-agent
