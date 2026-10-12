# Choose a product by required capabilities

Use the existing **Build a product** screen to load a committed Git source, search the maintained product recipes, and choose the capabilities the product must provide. Each requirement is matched against the same composed declarations used by the original distribution builder.

The default **Cover every requirement** option returns only products covering the entire selection. **Show partial matches** shows the exact missing capabilities for comparison. Build review requests require every selected capability. The selected product panel names the source registration that provides each capability.

| Requirement | Meaning |
| --- | --- |
| command:grant-workspace | The selected distribution registers this exact command. |
| application:grant-workspace | The selected distribution registers this exact Applications provider. |
| merchant:grant-workspaces | The selected distribution registers this exact merchant provider. |
| export:./grant-source-tables | The selected distribution exposes this exact package export. |
| feature:mcp | The selected distribution declares this optional runtime group. |
| source:grant-source-tables | The selected distribution includes this source-owned contribution. |

Load the capability list to choose the IDs that exist in your source. Capability provision records identify original base or contribution registrations. Runtime dependencies are recorded separately, with their declared package versions and available committed dependency locks.

## Terminal workflow

List available capability IDs:

~~~sh
starforge discover requirements --repository /srv/starforge/source
~~~

Find every maintained recipe covering a complete grant operations requirement:

~~~sh
starforge discover requirements \
  --repository /srv/starforge/source \
  --require command:grant-workspace \
  --require command:grant-source-tables \
  --out grant-product-plan.json
~~~

The JSON contains the immutable source commit, all matching products, each covered and missing requirement, original capability sources, and an accepted native review request for each complete match. Sorting retains the original product order by default. The other orders compare coverage, declared optional runtime-group count, or declared command count.

Prepare the selected recipe's review request against the source commit returned by that plan:

~~~sh
starforge discover review-request grant-operations \
  --repository /srv/starforge/source \
  --ref COPY_THE_PLAN_SOURCE_COMMIT \
  --require command:grant-workspace \
  --require command:grant-source-tables \
  --workspace /srv/starforge/runtime-workspace \
  --out grant-review-request.json
~~~

Use your real repository and workspace paths. The response gives the exact next argument vector for:

~~~sh
starforge runtime-workspace source-build-review \
  --workspace /srv/starforge/runtime-workspace \
  --request /absolute/path/grant-review-request.json
~~~

The browser's **Review selected product** action performs that same original review. The original source-build workflow then creates or reopens its saved review and build operation, packages the selected source and passes the completed package to **Source & profile** for adapter selection and installation. Follow [the source build guide](../runtime-workspace/SOURCE_BUILDS.md) for saved operation and package receiving commands.

Use the existing [product catalog](../product-catalog/README.md) for product text search, detailed inspection, comparison and installation plans. The requirements commands share its original source-build catalog.

## Runtime versions and dependency closure

Product inspection resolves every selected runtime-package manifest from the same committed source. Direct package versions keep their exact declared specifiers, and probes retain the original declarations.

When the manifest directory contains an original npm shrinkwrap or package lock with version 2 or 3 package records, inspection follows the production dependencies, optional dependencies and peer dependencies from the matching lock root. It records exact locked versions, package locations, direct and transitive instances, workspace links and unresolved edges. A lock whose root differs from the source manifest is shown as mismatched. Native peers and groups without a matching committed lock retain their declarations.

The dependency closure panel describes committed source dependencies. The original installer selects the target platform, installs the requested runtime groups and records the resulting runtime. Optional runtime-group and command counts compare the recipes' declarations.

## JavaScript and TypeScript

~~~js
import {
  matchProductRequirements,
  exportRequirementPlan,
  productReviewRequest,
} from '@tokenjunkielabs/starforge-merchant/operator/requirements';
import {
  loadProductRequirements,
} from '@tokenjunkielabs/starforge-merchant/operator/requirements/source';

const catalog = await loadProductRequirements({
  repository: '/srv/starforge/source',
  ref: 'HEAD',
});
const requirements = ['command:grant-workspace', 'command:grant-source-tables'];
const matches = matchProductRequirements(catalog.products, { requirements });
const plan = exportRequirementPlan(catalog, { requirements });
const request = productReviewRequest(catalog, 'grant-operations', { requirements });
~~~

Use the package name recorded by the installed distribution. The browser uses the same pure matching functions. The native source reader and composer own validation, source selection and immutable Git object acquisition. Output files are created exclusively; existing files remain attached to their original requests.
