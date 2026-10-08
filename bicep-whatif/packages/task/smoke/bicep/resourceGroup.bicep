// The smoke pipeline's `bicep` template at resource-group scope: a second empty
// network security group, tagged with the stand-in secret like the first.
//
// It goes into `rg-bicep-whatif-smoke`, which the subscription-scope stack
// creates, so run that stack's `create` first. Delete this stack before that
// one, or deleting theirs with resource groups set to delete takes this stack
// with it.
//
// Resource-group scope is the one with a chance of proving redaction here:
// the captured fixtures that carry property values came from stacks at this
// scope, where the subscription-scope smoke has never seen one.
targetScope = 'resourceGroup'

@secure()
@description('A stand-in secret, set in resourceGroup.bicepparam. Never a real one: it is committed.')
param smokeSecret string

@description('Changes every run, so that the tag is always a modify. Set by resourceGroup.bicepparam.')
param stamp string

module nsg 'nsg.bicep' = {
  name: 'bicep-whatif-smoke-group-nsg'
  params: {
    name: 'nsg-bicep-whatif-smoke-group'
    location: resourceGroup().location
    smokeSecret: smokeSecret
    stamp: stamp
  }
}
