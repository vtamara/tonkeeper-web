import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AssetAmount } from '@tonkeeper/core/dist/entries/crypto/asset/asset-amount';
import { ProState, ProSubscription } from '@tonkeeper/core/dist/entries/pro';
import { RecipientData } from '@tonkeeper/core/dist/entries/send';
import { isStandardTonWallet, StandardTonWalletState } from '@tonkeeper/core/dist/entries/wallet';
import {
    authViaTonConnect,
    createProServiceInvoice,
    createRecipient,
    getBackupState,
    getProServiceTiers,
    getProState,
    logoutTonConsole,
    setBackupState,
    startProServiceTrial,
    waitProServiceInvoice
} from '@tonkeeper/core/dist/service/proService';
import { InvoicesInvoice } from '@tonkeeper/core/dist/tonConsoleApi';
import { ProServiceTier } from '@tonkeeper/core/src/tonConsoleApi/models/ProServiceTier';
import { useMemo } from 'react';
import { useAppContext } from '../hooks/appContext';
import { useAppSdk } from '../hooks/appSdk';
import { useTranslation } from '../hooks/translation';
import { QueryKey } from '../libs/queryKey';
import { signTonConnectOver } from './mnemonic';
import { useCheckTouchId } from './password';
import { walletsStorage } from '@tonkeeper/core/dist/service/walletsService';
import { useActiveWallet } from './wallet';
import { useUserLanguage } from './language';
import { useWalletsStorage } from '../hooks/useStorage';

export const useProBackupState = () => {
    const sdk = useAppSdk();
    return useQuery<ProSubscription, Error>(
        [QueryKey.proBackup],
        () => getBackupState(sdk.storage),
        { keepPreviousData: true }
    );
};

export const useProState = () => {
    const wallet = useActiveWallet();
    const sdk = useAppSdk();
    const client = useQueryClient();
    return useQuery<ProState, Error>([QueryKey.pro], async () => {
        // TODO а что если активный кошелек не стандартный?
        // TODO сделать флоу подписки
        const state = await getProState(sdk.storage, wallet as StandardTonWalletState);
        await setBackupState(sdk.storage, state.subscription);
        await client.invalidateQueries([QueryKey.proBackup]);
        return state;
    });
};

export const useSelectWalletForProMutation = () => {
    const sdk = useAppSdk();
    const client = useQueryClient();
    const { api } = useAppContext();
    const { t } = useTranslation();
    const { mutateAsync: checkTouchId } = useCheckTouchId();

    return useMutation<void, Error, string>(async walletId => {
        const state = await walletsStorage(sdk.storage).getWallet(walletId);
        if (!state) {
            throw new Error('Missing wallet state');
        }

        if (!isStandardTonWallet(state)) {
            throw new Error("Can't use non-standard ton wallet for pro auth");
        }

        await authViaTonConnect(api, state, signTonConnectOver(sdk, walletId, t, checkTouchId));

        await client.invalidateQueries([QueryKey.pro]);
    });
};

export const useProLogout = () => {
    const client = useQueryClient();
    return useMutation(async () => {
        await logoutTonConsole();
        await client.invalidateQueries([QueryKey.pro]);
    });
};

export const useProPlans = (promoCode?: string) => {
    const { data: lang } = useUserLanguage();

    const all = useQuery<ProServiceTier[], Error>([QueryKey.pro, 'plans', lang], () =>
        getProServiceTiers(lang)
    );

    const promo = useQuery<ProServiceTier[], Error>(
        [QueryKey.pro, 'promo', lang, promoCode],
        () => getProServiceTiers(lang, promoCode !== '' ? promoCode : undefined),
        { enabled: promoCode !== '' }
    );

    return useMemo<[ProServiceTier[] | undefined, string | undefined]>(() => {
        if (!promo.data) {
            return [all.data, undefined];
        } else {
            return [promo.data, promoCode];
        }
    }, [all.data, promo.data]);
};

export interface ConfirmState {
    invoice: InvoicesInvoice;
    recipient: RecipientData;
    assetAmount: AssetAmount;
    wallet: StandardTonWalletState;
}

export const useCreateInvoiceMutation = () => {
    const ws = useWalletsStorage();
    const { api } = useAppContext();
    return useMutation<
        ConfirmState,
        Error,
        { state: ProState; tierId: number | null; promoCode?: string }
    >(async data => {
        if (data.tierId === null) {
            throw new Error('missing tier');
        }

        const wallet = await ws.getWallet(data.state.wallet.rawAddress);
        if (!wallet || !isStandardTonWallet(wallet)) {
            throw new Error('Missing wallet');
        }

        const invoice = await createProServiceInvoice(data.tierId, data.promoCode);
        const [recipient, assetAmount] = await createRecipient(api, invoice);
        return {
            invoice,
            wallet,
            recipient,
            assetAmount
        };
    });
};

export const useWaitInvoiceMutation = () => {
    const client = useQueryClient();
    return useMutation<void, Error, ConfirmState>(async data => {
        await waitProServiceInvoice(data.invoice);
        await client.invalidateQueries([QueryKey.pro]);
    });
};

export const useActivateTrialMutation = () => {
    const client = useQueryClient();
    const ctx = useAppContext();
    const {
        i18n: { language }
    } = useTranslation();

    return useMutation<boolean, Error>(async () => {
        const result = await startProServiceTrial(
            (ctx.env as { tgAuthBotId: string }).tgAuthBotId,
            language
        );
        await client.invalidateQueries([QueryKey.pro]);
        return result;
    });
};
