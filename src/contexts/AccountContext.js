import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { Client, dropsToXrp, Wallet, xrpToDrops } from "xrpl";
import { ToastManager } from "../components/Toast";

// Create a context
const AccountContext = createContext();

// Provider component
export const AccountProvider = ({ children }) => {
  const client = useRef();
  const [accounts, setAccounts] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState();
  const [balance, setBalance] = useState();
  const [transactions, setTransactions] = useState([]);
  const [reserve, setReserve] = useState();
  

  const _getBalance = useCallback(async (account) => {
    if (account) {
      // Create a connection to the ledger
      const client = new Client(process.env.REACT_APP_NETWORK);
      await client.connect();

      // Get the account balance from the latest ledger account info
      try {
        const response = await client.request({
          command: "account_info",
          account: account.address,
          ledger_index: "validated", // specify a ledger index OR a shortcut like validated, current or closed.
        });

        // Convert the balance returned in drops to XRP
        setBalance(dropsToXrp(response.result.account_data.Balance));
        
      } catch (error) {
        console.log(error);
        setBalance(); // Set balance to undefined - account doesn't exist
      } finally {
        client.disconnect();
      }
    }
  }, []);

  const _getTransactions = useCallback(async (account) => {
    if (account) {
      // Create client connection
      const client = new Client(process.env.REACT_APP_NETWORK);
      await client.connect();

      console.log("Getting transactions for account", account.address);

      try {
        const allTransactions = await client.request({
          command: "account_tx",
          account: account.address,
          ledger_index_min: -1, // Optional - Use to specify the earliest ledger to include transactions from. -1 = earliest validated ledger.
          ledger_index_max: -1, // Optional - Use to specify the newest ledger to include transactions from. -1 = newest validated ledger.
          limit: 20, // Optional - limit the number of transactions to receive.
          forward: false, // Optional - Returns the transactions with the oldest ledger first when set to true
        });

        console.log(allTransactions.result.transactions);

        // Filter the transactions - we only care about payments in XRP.
        const filteredTransactions = allTransactions.result.transactions
          .filter((transaction) => {
            // Filter for Payment transactions only.
            if (transaction.tx.TransactionType !== "Payment") return false;
            console.log(" Filtering transactions to show Payments ");

            // Filter for only XRP payments.
            return typeof transaction.tx.Amount === "string";
          })
          .map((transaction) => {
            return {
              account: transaction.tx.Account,
              destination: transaction.tx.Destination,
              hash: transaction.tx.hash,
              direction: transaction.tx.Account === account.address ? "Sent" : "Received",
              date: new Date((transaction.tx.date + 946684800) * 1000),
              transactionResult: transaction.meta.TransactionResult,
              amount:
                transaction.meta.TransactionResult === "tesSUCCESS"
                  ? dropsToXrp(transaction.meta?.delivered_amount)
                  : 0,
            };
          });

        setTransactions(filteredTransactions);
      } catch (error) {
        console.log(error);
        setTransactions([]);
      } finally {
        await client.disconnect();
      }
    }
  }, []);

  useEffect(() => {
    const storedAccounts = localStorage.getItem("accounts");
    const storedDefault = localStorage.getItem("selectedAccount");
    if (storedAccounts) {
      setAccounts(JSON.parse(storedAccounts));
    }
    if (storedDefault) {
      setSelectedWallet(JSON.parse(storedDefault));
    }

    const getCurrentReserve = async () => {
      // Create a connection to the ledger
      const client = new Client(process.env.REACT_APP_NETWORK);
      await client.connect();

      // Get the account balance from the latest ledger account info
      try {
        const response = await client.request({
          command: "server_info",
        });

        const reserve = response.result.info.validated_ledger.reserve_base_xrp;
        setReserve(reserve);

      } catch (error) {
        console.log(error);
      } finally {
        client.disconnect();
      }
      
    };
    
    getCurrentReserve();
    
  }, []);

  useEffect(() => {
    // Open a web socket to listen for transactions
    // This web socket will be created once and re-used
    if (!client.current) {
      client.current = new Client(process.env.REACT_APP_NETWORK);
    }
    const onTransaction = async (event) => {
      if (event.meta.TransactionResult === "tesSUCCESS") {
        if (event.transaction.Account === selectedWallet.address) {
          // Sent
          ToastManager.addToast(`Successfully sent ${dropsToXrp(event.transaction.Amount)} XRP`);
        } else if (event.transaction.Destination === selectedWallet.address) {
          ToastManager.addToast(
            `Successfully received ${dropsToXrp(event.transaction.Amount)} XRP`
          );
        }
      } else {
        //Handle the failed transaction
        ToastManager.addToast("Failed");
      }
      _getBalance(selectedWallet);
      _getTransactions(selectedWallet);
    };

    const listenToWallet = async () => {
      try {
        if (!client.current.isConnected()) await client.current.connect();
        client.current.on("transaction", onTransaction);

        await client.current.request({
          command: "subscribe",
          accounts: [selectedWallet?.address],
        });
      } catch (error) {
        console.error(error);
      } 
    };

    selectedWallet && listenToWallet();
    _getBalance(selectedWallet);
    _getTransactions(selectedWallet);

    return () => {
      // Clean-up if there is a previous connection open
      if (client.current.isConnected()) {
        (async () => {
          client.current.removeListener("transaction", onTransaction);
          await client.current.request({
            command: "unsubscribe",
            accounts: [selectedWallet.address],
          });
        })();
      }
    };
  }, [selectedWallet, _getBalance, _getTransactions]);

  const refreshBalance = () => {
    _getBalance(selectedWallet);
  };

  const refreshTransactions = () => {
    _getTransactions(selectedWallet);
  };

  const selectWallet = (account) => {
    localStorage.setItem("selectedAccount", JSON.stringify(account));
    setSelectedWallet(account);
  };

  const addAccount = (account) => {
    setAccounts((prevAccounts) => {
      const isDuplicate = prevAccounts.some((a) => a.address === account.address);

      if (isDuplicate) {
        // TODO: Update to use notifications system
        console.log("Account duplication: not added");
        return prevAccounts;
      } else {
        const updatedAccounts = [...prevAccounts, account];
        localStorage.setItem("accounts", JSON.stringify(updatedAccounts));
        return updatedAccounts;
      }
    });
  };

  const removeAccount = (account) => {
    setAccounts((prevAccounts) => {
      const updatedAccounts = prevAccounts.filter((a) => a !== account);
      localStorage.setItem("accounts", JSON.stringify(updatedAccounts));
      return updatedAccounts;
    });
  };

  const sendXRP = async (amount, destination, destinationTag) => {
    if (!selectedWallet) throw new Error("No wallet selected");

    // Get wallet from seed
    const wallet = Wallet.fromSeed(selectedWallet.seed);

    // New ledger connection
    const client = new Client(process.env.REACT_APP_NETWORK);
    await client.connect();

    try {
      // Create payment object
      const payment = {
        TransactionType: "Payment",
        Account: wallet.classicAddress,
        Amount: xrpToDrops(amount),
        Destination: destination,
      };

      if (destinationTag) {
        payment.DestinationTag = parseInt(destinationTag);
      }

      // Prepare transaction
      const prepared = await client.autofill(payment);

      // Sign the transaction
      const signed = wallet.sign(prepared);

      // Submit transaction and wait before running into finally block
      await client.submitAndWait(signed.tx_blob);
    } catch (error) {
      console.error(error);
    } finally {
      await client.disconnect();

      // Update the selectedWallet balance and transactions state
      refreshBalance(selectedWallet);
      console.log(`${balance}`);
      refreshTransactions(selectedWallet);
      console.log(`${reserve}`);
    }
  };

  
  return (
    <AccountContext.Provider
      value={{
        accounts,
        addAccount,
        removeAccount,
        selectWallet,
        balance,
        transactions,
        reserve,
        refreshBalance,
        refreshTransactions,
        sendXRP,
        selectedWallet,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
  
};

// Custom hook
export const useAccounts = () => useContext(AccountContext);