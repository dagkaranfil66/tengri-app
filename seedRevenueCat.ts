import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "replit-revenuecat-v2";

const PROJECT_NAME = "Tengri";
const APP_STORE_APP_NAME = "Tengri iOS";
const APP_STORE_BUNDLE_ID = "com.tengristar.app";
const PLAY_STORE_APP_NAME = "Tengri Android";
const PLAY_STORE_PACKAGE_NAME = "com.tengristar.app";

const ENTITLEMENT_IDENTIFIER = "altın";
const ENTITLEMENT_DISPLAY_NAME = "Tengri Altın";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Tengri Altın Paketleri";

const GOLD_PRODUCTS = [
  {
    id: "tengri_basic",
    displayName: "Başlangıç Paketi — 20 Altın",
    title: "Başlangıç Paketi",
    packageKey: "tengri_basic",
    packageDisplay: "20 Altın",
    priceTRY: 49_990_000,
    priceUSD: 1_990_000,
    gold: 20,
  },
  {
    id: "tengri_plus",
    displayName: "Popüler Paket — 50+5 Altın",
    title: "Popüler Paket",
    packageKey: "tengri_plus",
    packageDisplay: "50+5 Altın",
    priceTRY: 99_990_000,
    priceUSD: 3_990_000,
    gold: 55,
  },
  {
    id: "tengri_premium",
    displayName: "Premium Paket — 120+20 Altın",
    title: "Premium Paket",
    packageKey: "tengri_premium",
    packageDisplay: "120+20 Altın",
    priceTRY: 199_990_000,
    priceUSD: 7_990_000,
    gold: 140,
  },
  {
    id: "tengri_vip",
    displayName: "Mega Paket — 300+60 Altın",
    title: "Mega Paket",
    packageKey: "tengri_vip",
    packageDisplay: "300+60 Altın",
    priceTRY: 399_990_000,
    priceUSD: 14_990_000,
    gold: 360,
  },
];

type TestStorePricesResponse = { object: string; prices: { amount_micros: number; currency: string }[] };

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // ── Project ───────────────────────────────────────────────────────────────
  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({ client, query: { limit: 20 } });
  if (listProjectsError) throw new Error("Failed to list projects: " + JSON.stringify(listProjectsError));

  const existing = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existing) {
    console.log("Project already exists:", existing.id);
    project = existing;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project: " + JSON.stringify(error));
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  // ── Apps ──────────────────────────────────────────────────────────────────
  const { data: apps, error: listAppsError } = await listApps({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listAppsError || !apps?.items?.length) throw new Error("No apps found");

  let testApp: App = apps.items.find((a) => a.type === "test_store")!;
  if (!testApp) throw new Error("No test store app found");
  console.log("Test store app:", testApp.id);

  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  if (!appStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } } });
    if (error) throw new Error("Failed to create App Store app: " + JSON.stringify(error));
    appStoreApp = data;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app:", appStoreApp.id);
  }

  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");
  if (!playStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } } });
    if (error) throw new Error("Failed to create Play Store app: " + JSON.stringify(error));
    playStoreApp = data;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app:", playStoreApp.id);
  }

  // ── Products ──────────────────────────────────────────────────────────────
  const { data: existingProducts, error: listProductsError } = await listProducts({ client, path: { project_id: project.id }, query: { limit: 100 } });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProduct = async (storeApp: App, storeId: string, displayName: string, title: string, isTest: boolean): Promise<Product> => {
    const found = existingProducts.items?.find((p) => p.store_identifier === storeId && p.app_id === storeApp.id);
    if (found) { console.log(`  Product ${storeId} exists:`, found.id); return found; }

    const body: CreateProductData["body"] = {
      store_identifier: storeId,
      app_id: storeApp.id,
      type: "subscription",
      display_name: displayName,
    };
    if (isTest) {
      body.subscription = { duration: "P1M" };
      body.title = title;
    }
    const { data, error } = await createProduct({ client, path: { project_id: project.id }, body });
    if (error) throw new Error(`Failed to create product ${storeId}: ` + JSON.stringify(error));
    console.log(`  Created product ${storeId}:`, data.id);
    return data;
  };

  const productMap: Record<string, { test: Product; ios: Product; android: Product }> = {};

  for (const gp of GOLD_PRODUCTS) {
    console.log(`\nSetting up product: ${gp.displayName}`);
    const test = await ensureProduct(testApp, gp.id, gp.displayName, gp.title, true);
    const ios  = await ensureProduct(appStoreApp, gp.id, gp.displayName, gp.title, false);
    const android = await ensureProduct(playStoreApp, `${gp.id}:monthly`, gp.displayName, gp.title, false);
    productMap[gp.id] = { test, ios, android };

    // Add test store prices
    const { error: priceError } = await (client as any).post({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: test.id },
      body: { prices: [{ amount_micros: gp.priceUSD, currency: "USD" }, { amount_micros: gp.priceTRY, currency: "TRY" }] },
    });
    if (priceError) {
      if ((priceError as any)?.type === "resource_already_exists") {
        console.log("  Prices already set");
      } else {
        console.warn("  Price warning:", JSON.stringify(priceError));
      }
    } else {
      console.log("  Prices set");
    }
  }

  // ── Entitlement ───────────────────────────────────────────────────────────
  let entitlement: Entitlement;
  const { data: existingEntitlements, error: listEntErr } = await listEntitlements({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listEntErr) throw new Error("Failed to list entitlements");

  const existingEnt = existingEntitlements.items?.find((e) => e.lookup_key === ENTITLEMENT_IDENTIFIER);
  if (existingEnt) {
    console.log("\nEntitlement exists:", existingEnt.id);
    entitlement = existingEnt;
  } else {
    const { data, error } = await createEntitlement({ client, path: { project_id: project.id }, body: { lookup_key: ENTITLEMENT_IDENTIFIER, display_name: ENTITLEMENT_DISPLAY_NAME } });
    if (error) throw new Error("Failed to create entitlement: " + JSON.stringify(error));
    console.log("\nCreated entitlement:", data.id);
    entitlement = data;
  }

  // Attach all products to entitlement
  const allProductIds = Object.values(productMap).flatMap((m) => [m.test.id, m.ios.id, m.android.id]);
  const { error: attachEntError } = await attachProductsToEntitlement({ client, path: { project_id: project.id, entitlement_id: entitlement.id }, body: { product_ids: allProductIds } });
  if (attachEntError && (attachEntError as any)?.type !== "unprocessable_entity_error") {
    throw new Error("Failed to attach products to entitlement: " + JSON.stringify(attachEntError));
  }
  console.log("Attached all products to entitlement");

  // ── Offering ──────────────────────────────────────────────────────────────
  let offering: Offering;
  const { data: existingOfferings, error: listOffErr } = await listOfferings({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listOffErr) throw new Error("Failed to list offerings");

  const existingOff = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (existingOff) {
    console.log("\nOffering exists:", existingOff.id);
    offering = existingOff;
  } else {
    const { data, error } = await createOffering({ client, path: { project_id: project.id }, body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME } });
    if (error) throw new Error("Failed to create offering: " + JSON.stringify(error));
    console.log("\nCreated offering:", data.id);
    offering = data;
  }

  if (!offering.is_current) {
    await updateOffering({ client, path: { project_id: project.id, offering_id: offering.id }, body: { is_current: true } });
    console.log("Set offering as current");
  }

  // ── Packages ──────────────────────────────────────────────────────────────
  const { data: existingPkgs, error: listPkgErr } = await listPackages({ client, path: { project_id: project.id, offering_id: offering.id }, query: { limit: 20 } });
  if (listPkgErr) throw new Error("Failed to list packages");

  for (const gp of GOLD_PRODUCTS) {
    const existingPkg = existingPkgs.items?.find((p) => p.lookup_key === gp.packageKey);
    let pkg: Package;

    if (existingPkg) {
      console.log(`Package ${gp.packageKey} exists:`, existingPkg.id);
      pkg = existingPkg;
    } else {
      const { data, error } = await createPackages({ client, path: { project_id: project.id, offering_id: offering.id }, body: { lookup_key: gp.packageKey, display_name: gp.packageDisplay } });
      if (error) throw new Error(`Failed to create package ${gp.packageKey}: ` + JSON.stringify(error));
      console.log(`Created package ${gp.packageKey}:`, data.id);
      pkg = data;
    }

    const products = productMap[gp.id];
    const { error: attachPkgError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: products.test.id, eligibility_criteria: "all" },
          { product_id: products.ios.id, eligibility_criteria: "all" },
          { product_id: products.android.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgError && !(attachPkgError as any)?.message?.includes("Cannot attach product")) {
      console.warn(`  Package attach warning for ${gp.packageKey}:`, JSON.stringify(attachPkgError));
    } else {
      console.log(`  Products attached to package ${gp.packageKey}`);
    }
  }

  // ── API Keys ──────────────────────────────────────────────────────────────
  const { data: testKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: testApp.id } });
  const { data: iosKeys }  = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp.id } });
  const { data: droidKeys} = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp.id } });

  console.log("\n====================");
  console.log("Tengri RevenueCat setup tamamlandı!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("\nAPI Keys:");
  console.log("  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY =", testKeys?.items?.[0]?.key ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY =", iosKeys?.items?.[0]?.key ?? "N/A");
  console.log("  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY =", droidKeys?.items?.[0]?.key ?? "N/A");
  console.log("\nEnv Vars:");
  console.log("  REVENUECAT_PROJECT_ID =", project.id);
  console.log("  REVENUECAT_TEST_STORE_APP_ID =", testApp.id);
  console.log("  REVENUECAT_APPLE_APP_STORE_APP_ID =", appStoreApp.id);
  console.log("  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID =", playStoreApp.id);
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
