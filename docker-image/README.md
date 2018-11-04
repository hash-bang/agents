Doop-Agent Docker + AWS Batch
=============================
This directory contains the files required to get [Doop](https://github.com/MomsFriendlyDevCo/Doop) working with [AWS Batch](https://aws.amazon.com/batch/).


Setup
-----

1. Login to your [AWS Batch account](https://ap-southeast-2.console.aws.amazon.com/batch/home?region=ap-southeast-2)

2. Create a [Compute Environment](https://ap-southeast-2.console.aws.amazon.com/batch/home?region=ap-southeast-2#/compute-environments/new) with the following properties:

```
Compute environment type: managed
Compute environment name: doop-agents-compute (or whatever is specified in app.config.aws.batch.computeEnvironment)

Select EC2 keys as needed
Everything else either set as needed or leave as default

```

3. Create a [Job Definition](https://ap-southeast-2.console.aws.amazon.com/batch/home?region=ap-southeast-2#/job-definitions/new) with the following properties:

```
Job definition name: doop-agent
Job role: (empty)
Container image: momsfriendlydevco/doop-agent
vCPUs: 1 (Node is single core anyway)
Memory: 6000
Command: (leave as default)

Everything else either set as needed or leave as default
```

4. Create a [Job Queue](https://ap-southeast-2.console.aws.amazon.com/batch/home?region=ap-southeast-2#/queues/new) with the following properties:

```
Queue name: doop-agents-queue (or whatever is specified in app.config.aws.batch.queue)
Priority: 1
Compute environment: doop-compute

Everything else either set as needed or leave as default
```


Docker setup
============
The Docker image contains a minimal NodeJS + NPM install alongside a simple script to pull a zip file from a remote URL, decompress and execute it as an app.



