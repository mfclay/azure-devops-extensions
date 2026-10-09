// The smoke pipeline's `shortCircuit` template, at subscription scope, for a
// what-if only: it exists to make Azure report diagnostics, which no other
// smoke template does.
//
// A module whose resource ids cannot be worked out before the deploy is
// short-circuited: left out of the what-if result and named only in its
// `diagnostics`. Here the second module names its security group after the
// identity's principal id, which exists only once the identity does.
//
// Never `create` it. Nothing in it costs anything, but nothing needs to exist
// either: a what-if creates nothing.
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
