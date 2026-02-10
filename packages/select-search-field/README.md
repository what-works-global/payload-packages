# Payload Search Select Field

Server-backed search select field and plugin for Payload. The client component queries a shared endpoint
and passes the current search query plus any currently selected values.

## Demo

https://github.com/user-attachments/assets/0f49d3f9-8473-4d77-8e20-ee07a1276a8e


## Usage

Add the plugin:

```ts
import { selectSearchPlugin } from '@whatworks/payload-select-search-field'

export default buildConfig({
  plugins: [selectSearchPlugin()],
})
```

Add a field with `selectSearch` (recommended):

```ts
import { selectSearch } from '@whatworks/payload-select-search-field'

selectSearch({
  name: 'stripeCustomer',
  hasMany: true,
  searchFunction: async ({ query, selectedValues }) => {
    return [
      { value: 'cus_123', label: `Result for ${query}` },
      ...selectedValues.map((value) => ({
        value,
        label: `Selected: ${value}`,
      })),
    ]
  },
})
```

`searchFunction` receives:
- `query`: the current input text.
- `selectedValues`: an array of currently selected values (empty array when nothing is selected).
- `req`, `field`, and `collection`/`global` context.

The client component calls the shared endpoint path from `selectSearchEndpoint`.
