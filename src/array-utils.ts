// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export function isEmpty(arr?: any[]): boolean {
    if (arr && arr.length > 0) {
        return false;
    }
    return true;
}
