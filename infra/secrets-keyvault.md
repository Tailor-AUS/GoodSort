# Migrating Container App secrets to Key Vault references

## Problem

The `api` Container App currently stores its secrets as **plaintext environment
variables**:

- `JWT_SECRET`
- `ConnectionStrings__goodsortdb` (includes the SQL admin password)
- `TAILOR_VISION_API_KEY`
- `AZURE_OPENAI_KEY`
- `ACS_CONNECTION_STRING`

Anyone with `Reader` on `rg-GoodSort` can read them via `az containerapp show`.
They should be Container App **secrets** backed by **Key Vault references**, so the
values live in `tailor-prod-kv-ae01` (already exists in `rg-tailor-app-prod`) and
the app reads them via managed identity.

## Target shape

1. **Store each secret in Key Vault:**

   ```bash
   KV=tailor-prod-kv-ae01
   az keyvault secret set --vault-name $KV --name goodsort-jwt-secret      --value "<...>"
   az keyvault secret set --vault-name $KV --name goodsort-db-conn         --value "<...>"
   az keyvault secret set --vault-name $KV --name goodsort-tailor-vision   --value "<...>"
   az keyvault secret set --vault-name $KV --name goodsort-openai-key      --value "<...>"
   az keyvault secret set --vault-name $KV --name goodsort-acs-conn        --value "<...>"
   ```

2. **Give the Container App a managed identity and grant it `get` on secrets:**

   ```bash
   az containerapp identity assign -n api -g rg-GoodSort --system-assigned
   PRINCIPAL=$(az containerapp identity show -n api -g rg-GoodSort --query principalId -o tsv)
   az keyvault set-policy --name $KV --object-id $PRINCIPAL --secret-permissions get
   # (or assign the "Key Vault Secrets User" RBAC role if the vault uses RBAC)
   ```

3. **Define Container App secrets as Key Vault references, then point env vars at them:**

   ```bash
   az containerapp secret set -n api -g rg-GoodSort --secrets \
     jwt-secret=keyvaultref:https://$KV.vault.azure.net/secrets/goodsort-jwt-secret,identityref:system \
     db-conn=keyvaultref:https://$KV.vault.azure.net/secrets/goodsort-db-conn,identityref:system \
     tailor-vision=keyvaultref:https://$KV.vault.azure.net/secrets/goodsort-tailor-vision,identityref:system \
     openai-key=keyvaultref:https://$KV.vault.azure.net/secrets/goodsort-openai-key,identityref:system \
     acs-conn=keyvaultref:https://$KV.vault.azure.net/secrets/goodsort-acs-conn,identityref:system

   az containerapp update -n api -g rg-GoodSort --set-env-vars \
     "JWT_SECRET=secretref:jwt-secret" \
     "ConnectionStrings__goodsortdb=secretref:db-conn" \
     "TAILOR_VISION_API_KEY=secretref:tailor-vision" \
     "AZURE_OPENAI_KEY=secretref:openai-key" \
     "ACS_CONNECTION_STRING=secretref:acs-conn"
   ```

## Update the postdeploy hook

Once migrated, `infra/restore-secrets.{sh,ps1}` should set the `secretref:` form
above instead of plaintext values, so `azd deploy` re-applies references rather than
re-leaking the raw values. (Left as-is for now because the hook is the current
source of truth and changing it without the Key Vault entries in place would break
deploys.)

## Rotate after migration

`JWT_SECRET` and the SQL password were readable in plaintext historically — rotate
both as part of this migration (note: rotating `JWT_SECRET` invalidates all live
sessions and any unredeemed OTPs, since OTP hashing is keyed by it).
