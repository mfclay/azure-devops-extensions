// The smoke pipeline's `bicep` template. It exists to put three things in front
// of Azure that the empty template cannot: a Bicep compile (and the run-time
// download of the compiler), a `.bicepparam` file, and a `@secure()` value that
// reaches the what-if payload, which redaction has to catch.
//
// One resource group, which costs nothing. The secret is written to a tag only
// so that the what-if `after` carries it; it is a stand-in, not a credential.
targetScope = 'subscription'

@description('The resource group\'s location; the stack\'s own by default.')
param location string = deployment().location

@secure()
@description('A stand-in secret, set in main.bicepparam. Never a real one: it is committed.')
param smokeSecret string

resource smoke 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-bicep-whatif-smoke'
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
    smokeSecret: smokeSecret
  }
}
