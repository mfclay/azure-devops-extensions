// The smoke pipeline's `bicep` template at resource-group scope: a second empty
// network security group, tagged with the stand-in secret like the first.
//
// It goes into `rg-bicep-whatif-smoke`, which the subscription-scope stack
// creates, so run that stack's `create` first. Delete this stack before that
// one, or deleting theirs with resource groups set to delete takes this stack
// with it.
//
// The captured fixtures that carry property values came from stacks at this
// scope, but this stack's what-if has not returned any either: the tagged
// group, created or modified, comes back with no resourceConfigurationChanges.
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

// Outputs, for a create to set as output variables of the task step, which the
// smoke reads back in a later step. The second carries the stand-in inside a
// longer string and is not masked, so only by-value redaction of the @secure()
// parameter keeps it out of the attached payload. The third is named in
// maskedOutputs, so the payload must not carry it either, though it holds no
// secure value.
output smokeResourceId string = nsg.outputs.id

#disable-next-line outputs-should-not-contain-secrets
output smokeSecretOutput string = 'echo:${smokeSecret}|${stamp}'

output smokeMaskedOutput string = 'masked-${stamp}'
