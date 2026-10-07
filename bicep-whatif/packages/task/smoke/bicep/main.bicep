// The smoke pipeline's `bicep` template. It exists to put three things in front
// of Azure that the empty template cannot: a Bicep compile (and the run-time
// download of the compiler), a `.bicepparam` file, and a `@secure()` value that
// reaches the what-if payload, which redaction has to catch.
//
// One resource group holding one network security group, neither of which
// costs anything. The secret is written to the group's tag only so that a
// what-if carries it; it is a stand-in, not a credential.
//
// Where the secret can show up is narrow. ARM blanks secure values in the
// parameters it echoes back, and a stack what-if lists a resource group's own
// changes without any property values, so tagging the resource group (as a
// first version of this did) never put the secret in the payload. Resources
// inside a group do get property values, in `resourceConfigurationChanges`.
// The tag joins the secret to a stamp that changes every run, so once the
// group exists every what-if is a modify whose delta holds the secret inside a
// longer string, which is the case value-based redaction exists for.
targetScope = 'subscription'

@description('Where both resources go; the stack\'s own location by default.')
param location string = deployment().location

@secure()
@description('A stand-in secret, set in main.bicepparam. Never a real one: it is committed.')
param smokeSecret string

@description('Changes every run, so that the tag is always a modify.')
param stamp string = utcNow()

resource smoke 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-bicep-whatif-smoke'
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
  }
}

module nsg 'nsg.bicep' = {
  name: 'bicep-whatif-smoke-nsg'
  scope: smoke
  params: {
    location: location
    smokeSecret: smokeSecret
    stamp: stamp
  }
}
