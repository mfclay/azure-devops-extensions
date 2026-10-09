// The smoke pipeline's `shortCircuit` template, at subscription scope. It
// exists to make Azure report diagnostics, which no other smoke template does.
//
// A resource whose id cannot be worked out before the deploy is
// short-circuited. Here the second module names its security group after the
// identity's principal id, which exists only once the identity does. The stack
// what-if then gives the group an `unsupported` row whose id is the unevaluated
// expression, and a `ShortCircuitedResourceId` warning.
//
// Run as `whatIf` alone, that is all (smoke build 81). After a `create`, the
// next what-if also reports the deployed group as a `potential` detach, the
// same group as the unsupported row (build 85): the pairing a real estate shows
// for role assignments named after a principal id. Nothing here costs anything;
// clean up with `operation: delete`, `unmanage: delete`.
targetScope = 'subscription'

@description('Where both resources go; the stack\'s own location by default.')
param location string = deployment().location

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-bicep-whatif-short-circuit'
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
  }
}

module identity 'identity.bicep' = {
  name: 'bicep-whatif-smoke-identity'
  scope: group
  params: {
    location: location
  }
}

module named 'namedNsg.bicep' = {
  name: 'bicep-whatif-smoke-short-circuited'
  scope: group
  params: {
    location: location
    name: 'nsg-${identity.outputs.principalId}'
  }
}
