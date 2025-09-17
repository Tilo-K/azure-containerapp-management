#!/usr/bin/env bun
import arg from "arg";
import {
    stopApps,
    startApps,
    restartApps,
    listApps,
    followLogs,
} from "./commands";

async function main() {
    const args = arg({
        "--list": Boolean,
        "--stop": Boolean,
        "--start": Boolean,
        "--restart": Boolean,
        "--glob": String,
        "--logs": String,
        "--tenant": String,
        "-l": "--list",
        "-g": "--glob",
        "-s": "--start",
        "-r": "--restart",
        "-t": "--stop",
        "-fl": "--logs",
        "-te": "--tenant",
    });

    let glob = "*";
    let tenant = "*";
    if (args["--glob"]) {
        glob = args["--glob"];
    }

    if (args["--tenant"]) {
        tenant = args["--tenant"];
    }

    if (args["--logs"]) {
        await followLogs(args["--logs"]);
    } else if (args["--stop"]) {
        await listApps(tenant, glob);
        if (prompt("Are you sure you want to stop these apps? [y/N]") !== "y") {
            return;
        }
        stopApps(tenant, glob);
    } else if (args["--start"]) {
        await listApps(tenant, glob);
        if (
            prompt("Are you sure you want to start these apps? [y/N]") !== "y"
        ) {
            return;
        }
        startApps(tenant, glob);
    } else if (args["--restart"]) {
        await listApps(glob);
        if (
            prompt("Are you sure you want to restart these apps? [y/N]") !== "y"
        ) {
            return;
        }
        restartApps(tenant, glob);
    } else {
        listApps(tenant, glob);
    }
}

await main();
