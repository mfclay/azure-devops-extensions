using 'main.bicep'

// The smoke pipeline fails the run if this exact string appears in anything
// the task wrote, so keep the two in step.
param smokeSecret = 'smoke-stand-in-5c1e9d'

// The build id, which the agent sets for every step and Bicep reads at compile
// time, so each run hands the stack a parameter value it has not seen.
param stamp = readEnvironmentVariable('BUILD_BUILDID', 'local')
