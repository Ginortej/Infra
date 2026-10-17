package virt

import (
	"fmt"
	"os"
	"strings"

	"time"

	diskfs "github.com/diskfs/go-diskfs"
	"github.com/diskfs/go-diskfs/disk"
	"github.com/diskfs/go-diskfs/filesystem"
	"github.com/diskfs/go-diskfs/filesystem/iso9660"

	"infra/internal/vault"
)

// UserData — cloud-config: hostname, пользователь с ключом и sudo без пароля.
func UserData(lab vault.Lab, s vault.VMSpec, pubKey string) string {
	user := lab.User
	if user == "" {
		user = "ubuntu"
	}
	return fmt.Sprintf(`#cloud-config
hostname: %s
fqdn: %s
manage_etc_hosts: true
users:
  - default
  - name: %s
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - %s
ssh_pwauth: false
`, s.Host, s.Host, user, pubKey)
}

// NetworkConfig — статический IP. VirtualBox: NIC1 = NAT (интернет), NIC2 = host-only (IP лабы).
// VMware: одна карта в выбранной vmnet со статическим IP и шлюзом.
func NetworkConfig(lab vault.Lab, s vault.VMSpec, provider string) string {
	addr := fmt.Sprintf("%s/%d", s.IP, lab.PrefixLen())
	dns := lab.Network.DNS
	if len(dns) == 0 {
		dns = []string{"1.1.1.1", "8.8.8.8"}
	}
	if provider == "virtualbox" {
		return fmt.Sprintf(`version: 2
ethernets:
  nat:
    match:
      macaddress: "%s"
    dhcp4: true
  lab:
    match:
      macaddress: "%s"
    dhcp4: false
    addresses: [%s]
`, macColon(vboxMAC(s.Name, 1)), macColon(vboxMAC(s.Name, 2)), addr)
	}
	gw := lab.Network.Gateway
	routes := ""
	if gw != "" {
		routes = fmt.Sprintf("\n    routes:\n      - to: default\n        via: %s", gw)
	}
	return fmt.Sprintf(`version: 2
ethernets:
  lab:
    match:
      macaddress: "%s"
    dhcp4: false
    addresses: [%s]%s
    nameservers:
      addresses: [%s]
`, macColon(vmwareMAC(s.Name, 0)), addr, routes, strings.Join(dns, ", "))
}

// WriteSeedISO создаёт NoCloud ISO (метка CIDATA, имена через Joliet) для cloud-init.
func WriteSeedISO(path string, lab vault.Lab, s vault.VMSpec, pubKey, provider string) error {
	_ = os.Remove(path)
	d, err := diskfs.Create(path, 2*1024*1024, diskfs.SectorSizeDefault)
	if err != nil {
		return err
	}
	defer d.Close()
	d.LogicalBlocksize = 2048
	fsys, err := d.CreateFilesystem(disk.FilesystemSpec{Partition: 0, FSType: filesystem.TypeISO9660, VolumeLabel: "cidata"})
	if err != nil {
		return err
	}
	files := map[string]string{
		"/user-data":      UserData(lab, s, pubKey),
		"/meta-data":      fmt.Sprintf("instance-id: %s-%d\nlocal-hostname: %s\n", s.Name, time.Now().Unix(), s.Host),
		"/network-config": NetworkConfig(lab, s, provider),
	}
	for name, body := range files {
		f, err := fsys.OpenFile(name, os.O_CREATE|os.O_RDWR)
		if err != nil {
			return err
		}
		if _, err := f.Write([]byte(body)); err != nil {
			return err
		}
		f.Close()
	}
	iso, ok := fsys.(*iso9660.FileSystem)
	if !ok {
		return fmt.Errorf("не ISO9660")
	}
	return iso.Finalize(iso9660.FinalizeOptions{Joliet: true, VolumeIdentifier: "cidata"})
}
