using 'main.bicep'

// The smoke pipeline fails the run if this exact string appears in anything
// the task wrote, so keep the two in step.
param smokeSecret = 'smoke-stand-in-5c1e9d'
