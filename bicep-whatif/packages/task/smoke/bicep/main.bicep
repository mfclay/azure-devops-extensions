// The smoke pipeline's `bicep` template. It exists to put three things in front
// of Azure that the empty template cannot: a Bicep compile (and the run-time
// download of the compiler), a `.bicepparam` file, and a `@secure()` value that
// reaches the what-if payload, which redaction has to catch.
//
// One resource group, which costs nothing. The secret is written to a tag only
// so that a what-if carries it; it is a stand-in, not a credential.
//
// A create carries no property values in a stack what-if, only the resource's
// identity, and ARM blanks secure values in the parameters it echoes back. So
// the secret reaches the payload only as a modify, in the `delta`. The tag
// joins it to a stamp that changes every run: once a `deploy` run has created
// the group, every what-if is a modify whose delta holds the secret inside a
// longer string, which is the case value-based redaction exists for.
targetScope = 'subscription'

@description('The resource group\'s location; the stack\'s own by default.')
param location string = deployment().location

@secure()
@description('A stand-in secret, set in main.bicepparam. Never a real one: it is committed.')
param smokeSecret string

@description('Changes every run, so that the tag below is always a modify.')
param stamp string = utcNow()

resource smoke 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-bicep-whatif-smoke'
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
    smokeSecret: '${smokeSecret}|${stamp}'
  }
}
