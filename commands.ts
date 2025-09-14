import { Glob } from "bun";
import { table } from "table";
import { Listr } from "listr2";
import { AzureCliCredential } from "@azure/identity";
import {
    ContainerAppsAPIClient,
    type ContainerApp,
} from "@azure/arm-appcontainers";

import { $ } from "bun";

type AzSubscription = {
    id: string;
    name: string;
    subscriptionId: string;
    tenantId: string;
    state: "Enabled" | string;
};

type IdParts = {
    subscriptionId: string;
    resourceGroupName: string;
    name: string;
};

let cachedSubscriptions: AzSubscription[] | undefined = undefined;

async function getCliSubscriptions(): Promise<AzSubscription[]> {
    if (cachedSubscriptions) {
        return cachedSubscriptions;
    }
    const res = await $`az account list --all --output json`.quiet();

    const subs = JSON.parse(res.text()) as any[];

    const sbs = subs
        .filter(
            (s) =>
                s.id &&
                s.tenantId &&
                s.state === "Enabled" &&
                !s.name.includes("Test")
        )
        .map((s) => ({
            id: s.id,
            name: s.name,
            subscriptionId: s.id,
            tenantId: s.tenantId,
            state: s.state,
        }));

    cachedSubscriptions = sbs;
    return sbs;
}

function parseContainerAppId(id: string): IdParts {
    const m = id.match(
        /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.App\/containerApps\/([^/]+)$/i
    );
    if (!m) throw new Error("Invalid Container App resource ID");
    return { subscriptionId: m[1]!, resourceGroupName: m[2]!, name: m[3]! };
}

async function getApps(glob: string = "*") {
    const apps = [];
    const credential = new AzureCliCredential();
    const subscriptions = await getCliSubscriptions();

    const pattern = new Glob(glob);

    for (const sub of subscriptions) {
        const client = new ContainerAppsAPIClient(credential, sub.id);

        const result = await client.containerApps.listBySubscription();

        for await (const app of result) {
            if (!pattern.match(app.name ?? "")) {
                continue;
            }

            apps.push(app);
        }
    }
    return apps;
}

async function listApps(glob: string = "*", nums: boolean = false) {
    const rows = [
        [
            "Name",
            "Subscription",
            "Resource Group",
            "Location",
            "Image(s)",
            "Status",
        ],
    ];
    if (nums) {
        rows[0] = ["#", ...rows[0]!];
    }
    let i = 0;
    for (const app of await getApps(glob)) {
        const parsed = parseContainerAppId(app.id!);

        const images =
            app.template?.containers
                ?.map((c) => c.image?.split("/").at(-1) ?? "")
                .join("\n") ?? "";

        let arr = [
            app.name ?? "No name",
            parsed.subscriptionId.split("-").at(-1) ?? "",
            parsed.resourceGroupName,
            app.location,
            images,
            app.runningStatus ?? "Unknown",
        ];

        if (nums) {
            arr = [i.toString(), ...arr];
            i++;
        }
        rows.push(arr);
    }

    console.log(table(rows));
}

async function followLogs(glob: string = "*") {
    const apps = await getApps(glob);

    let app = apps[0];
    if (apps.length > 1) {
        await listApps(glob, true);
        const i = parseInt(prompt("Which app do you want to follow?") ?? "-1");
        if (i < 0 || i >= apps.length) {
            console.log("Invalid index");
            return;
        }
        app = apps[i];
    }
    if (!app) {
        console.log("No apps found");
        return;
    }
    const parsed = parseContainerAppId(app.id!);
    console.log(
        `az containerapp logs show --name ${app.name} --resource-group ${parsed.resourceGroupName} --follow`
    );

    await $`az containerapp logs show --name ${app.name} --resource-group ${parsed.resourceGroupName} --follow`;
}

async function stopApps(glob: string = "*") {
    const g = new Glob(glob);
    const credential = new AzureCliCredential();
    const subscriptions = await getCliSubscriptions();

    const tasks = [];

    for (const sub of subscriptions) {
        const client = new ContainerAppsAPIClient(credential, sub.id);

        for await (const app of client.containerApps.listBySubscription()) {
            if (!g.match(app.name ?? "")) {
                continue;
            }
            const parsed = parseContainerAppId(app.id!);

            const prom = client.containerApps.beginStopAndWait(
                parsed.resourceGroupName,
                parsed.name
            );

            tasks.push({ title: " " + parsed.name, task: () => prom });
        }
    }

    console.log(`Stopping ${tasks.length} apps`);
    await new Listr(tasks as any).run();
}

async function startApps(glob: string = "*") {
    const g = new Glob(glob);
    const credential = new AzureCliCredential();
    const subscriptions = await getCliSubscriptions();

    const tasks = [];

    for (const sub of subscriptions) {
        const client = new ContainerAppsAPIClient(credential, sub.id);

        for await (const app of client.containerApps.listBySubscription()) {
            if (!g.match(app.name ?? "")) {
                continue;
            }
            const parsed = parseContainerAppId(app.id!);

            const prom = client.containerApps.beginStartAndWait(
                parsed.resourceGroupName,
                parsed.name
            );

            tasks.push({ title: " " + parsed.name, task: () => prom });
        }
    }

    console.log(`Starting ${tasks.length} apps`);
    await new Listr(tasks as any).run();
}

async function restartApps(glob: string = "*") {
    await stopApps(glob);
    await startApps(glob);
}

export { getApps, listApps, stopApps, startApps, restartApps, followLogs };
