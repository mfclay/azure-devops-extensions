// The smoke pipeline's `bicep` template at subscription scope. It exists to put three things in front
// of Azure that the empty template cannot: a Bicep compile (and the run-time
// download of the compiler), a `.bicepparam` file, and a `@secure()` value that
// redaction would have to catch if it reached the what-if payload.
//
// One resource group holding one network security group, neither of which
// costs anything. The secret is written to the group's tag only so that a
// what-if carries it; it is a stand-in, not a credential.
//
// The tag joins the secret to a stamp that changes every run, so once the
// group exists every what-if is a modify. If ARM reported property values, its
// delta would hold the secret inside a longer string, which is the case
// value-based redaction exists for. Against Azure it has not: ARM blanks secure
// values in the parameters it echoes, and the subscription-scope stack what-if
// has returned no property values for the resource group or the security
// group, created or modified. The captured fixtures, which do carry
// `resourceConfigurationChanges`, came from stacks scoped to a resource group.
//
// The stamp is passed in by subscription.bicepparam, not defaulted here. As a
// `utcNow()` default it changed every run and the stack what-if still called
// the tag a definite noChange; passed as a value, the same change is a modify.
// The stack what-if compares the parameter values it is handed and does not
// evaluate defaults.
targetScope = 'subscription'

@description('Where both resources go; the stack\'s own location by default.')
param location string = deployment().location

@secure()
@description('A stand-in secret, set in subscription.bicepparam. Never a real one: it is committed.')
param smokeSecret string

@description('Changes every run, so that the tag is always a modify. Set by subscription.bicepparam.')
param stamp string

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
